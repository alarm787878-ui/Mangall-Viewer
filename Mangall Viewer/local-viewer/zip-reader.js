(function () {
  // ZIP/CBZ 파일 안의 이미지를 꺼내는 도구.
  // 파일 전체를 한 번에 메모리에 올리지 않고, 필요한 부분만 잘라서(slice) 읽는다.
  // - 압축 없이 저장된 이미지(CBZ에 흔함)는 원본 파일 조각을 그대로 써서 복사가 없다.
  // - 압축된 이미지는 브라우저 기본 기능(DecompressionStream)으로 푼다.

  const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|jfif|png|svg|webp)$/i;

  // ZIP 구조에서 각 부분의 시작을 알리는 고정 표식 값
  const SIGNATURE_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
  const SIGNATURE_ZIP64_END_LOCATOR = 0x07064b50;
  const SIGNATURE_ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
  const SIGNATURE_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
  const SIGNATURE_LOCAL_FILE_HEADER = 0x04034b50;

  // 32비트 칸이 이 값이면 "진짜 값은 ZIP64 확장 영역에 있다"는 뜻
  const ZIP64_MARKER_32 = 0xffffffff;
  const ZIP64_MARKER_16 = 0xffff;

  const COMPRESSION_STORED = 0;
  const COMPRESSION_DEFLATE = 8;

  // 끝부분 기록(EOCD)은 22바이트 + 최대 65535바이트 주석
  const END_RECORD_MIN_SIZE = 22;
  const END_RECORD_SEARCH_SIZE = END_RECORD_MIN_SIZE + 0xffff;

  async function readBytes(file, start, end) {
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
  }

  function toView(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function getUint64(view, offset) {
    // 9천조 바이트를 넘는 파일은 없으므로 일반 숫자로 바꿔도 안전하다.
    return Number(view.getBigUint64(offset, true));
  }

  function decodeEntryName(bytes, hasUtf8Flag) {
    if (hasUtf8Flag) {
      return new TextDecoder("utf-8").decode(bytes);
    }

    // 표시가 없어도 UTF-8로 저장하는 프로그램(맥 등)이 있어 먼저 엄격하게 시도한다.
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
    }

    // 윈도우에서 만든 한글 ZIP은 대부분 CP949(EUC-KR 확장) 방식이다.
    try {
      return new TextDecoder("euc-kr").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }

  function getMimeTypeFromName(name) {
    const lower = String(name || "").toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".avif")) return "image/avif";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".bmp")) return "image/bmp";
    return "image/jpeg";
  }

  // 맥에서 압축할 때 생기는 숨김 찌꺼기 파일은 건너뛴다.
  function isJunkEntry(name) {
    const parts = String(name || "").split("/");
    const baseName = parts[parts.length - 1] || "";
    return parts.includes("__MACOSX") || baseName.startsWith("._");
  }

  async function findEndRecord(file) {
    const searchStart = Math.max(0, file.size - END_RECORD_SEARCH_SIZE);
    const tail = await readBytes(file, searchStart, file.size);
    const view = toView(tail);

    for (let offset = tail.byteLength - END_RECORD_MIN_SIZE; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) !== SIGNATURE_END_OF_CENTRAL_DIRECTORY) continue;

      let entryCount = view.getUint16(offset + 10, true);
      let directorySize = view.getUint32(offset + 12, true);
      let directoryOffset = view.getUint32(offset + 16, true);

      const needsZip64 =
        entryCount === ZIP64_MARKER_16 ||
        directorySize === ZIP64_MARKER_32 ||
        directoryOffset === ZIP64_MARKER_32;

      // 4GB가 넘거나 파일이 아주 많은 ZIP은 ZIP64 방식으로 진짜 값을 따로 적어 둔다.
      const locatorOffset = offset - 20;
      if (
        locatorOffset >= 0 &&
        view.getUint32(locatorOffset, true) === SIGNATURE_ZIP64_END_LOCATOR
      ) {
        const zip64RecordOffset = getUint64(view, locatorOffset + 8);
        const zip64Record = toView(await readBytes(file, zip64RecordOffset, zip64RecordOffset + 56));
        if (zip64Record.getUint32(0, true) === SIGNATURE_ZIP64_END_OF_CENTRAL_DIRECTORY) {
          entryCount = getUint64(zip64Record, 32);
          directorySize = getUint64(zip64Record, 40);
          directoryOffset = getUint64(zip64Record, 48);
        } else if (needsZip64) {
          throw new Error("ZIP64 정보를 읽지 못했습니다.");
        }
      } else if (needsZip64) {
        throw new Error("ZIP64 정보를 읽지 못했습니다.");
      }

      return { entryCount, directorySize, directoryOffset };
    }

    throw new Error("ZIP 파일이 아니거나 손상된 파일입니다.");
  }

  // ZIP64 확장 영역(id 0x0001)에서 32비트 칸에 다 못 담은 진짜 값을 꺼낸다.
  function applyZip64Extra(entry, view, extraStart, extraLength) {
    let cursor = extraStart;
    const extraEnd = extraStart + extraLength;

    while (cursor + 4 <= extraEnd) {
      const headerId = view.getUint16(cursor, true);
      const dataSize = view.getUint16(cursor + 2, true);
      let fieldCursor = cursor + 4;

      if (headerId === 0x0001) {
        // 값은 정해진 순서대로, 32비트 칸이 꽉 찬 항목만 들어 있다.
        if (entry.uncompressedSize === ZIP64_MARKER_32) {
          entry.uncompressedSize = getUint64(view, fieldCursor);
          fieldCursor += 8;
        }
        if (entry.compressedSize === ZIP64_MARKER_32) {
          entry.compressedSize = getUint64(view, fieldCursor);
          fieldCursor += 8;
        }
        if (entry.localHeaderOffset === ZIP64_MARKER_32) {
          entry.localHeaderOffset = getUint64(view, fieldCursor);
        }
        return;
      }

      cursor += 4 + dataSize;
    }
  }

  async function readEntries(file) {
    const { entryCount, directorySize, directoryOffset } = await findEndRecord(file);
    const directory = await readBytes(file, directoryOffset, directoryOffset + directorySize);
    const view = toView(directory);
    const entries = [];
    let offset = 0;

    for (let i = 0; i < entryCount; i += 1) {
      if (offset + 46 > directory.byteLength) break;
      if (view.getUint32(offset, true) !== SIGNATURE_CENTRAL_DIRECTORY_ENTRY) {
        throw new Error("ZIP 목록 형식이 올바르지 않습니다.");
      }

      const flags = view.getUint16(offset + 8, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const nameBytes = directory.subarray(offset + 46, offset + 46 + nameLength);

      const entry = {
        name: decodeEntryName(nameBytes, !!(flags & 0x0800)).replace(/\\/g, "/"),
        isEncrypted: !!(flags & 0x0001),
        compressionMethod: view.getUint16(offset + 10, true),
        compressedSize: view.getUint32(offset + 20, true),
        uncompressedSize: view.getUint32(offset + 24, true),
        localHeaderOffset: view.getUint32(offset + 42, true)
      };
      applyZip64Extra(entry, view, offset + 46 + nameLength, extraLength);
      entries.push(entry);

      offset += 46 + nameLength + extraLength + commentLength;
    }

    return entries;
  }

  async function readEntryBlob(file, entry) {
    // 각 파일 앞의 작은 머리말(30바이트 + 이름 + 추가 정보) 다음부터가 실제 데이터다.
    const header = toView(await readBytes(file, entry.localHeaderOffset, entry.localHeaderOffset + 30));
    if (header.getUint32(0, true) !== SIGNATURE_LOCAL_FILE_HEADER) {
      throw new Error("ZIP 안 파일 정보를 읽지 못했습니다.");
    }

    const dataStart =
      entry.localHeaderOffset +
      30 +
      header.getUint16(26, true) +
      header.getUint16(28, true);
    const rawData = file.slice(dataStart, dataStart + entry.compressedSize);
    const type = getMimeTypeFromName(entry.name);

    if (entry.compressionMethod === COMPRESSION_STORED) {
      // 압축 없이 저장된 경우: 원본 파일 조각을 그대로 이미지로 쓴다. (복사 없음)
      return new Blob([rawData], { type });
    }

    if (typeof DecompressionStream !== "function") {
      throw new Error("이 브라우저에서는 ZIP 압축 해제를 지원하지 않습니다.");
    }

    const stream = rawData.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const inflated = await new Response(stream).blob();
    return new Blob([inflated], { type });
  }

  // file: ZIP 파일, displayPath: 화면과 정렬에 쓸 ZIP 경로(예: "만화/1권.zip")
  // 반환: [{ name, url }] — name은 "ZIP 경로/ZIP 안 경로" 형태라 여러 ZIP을 섞어도 순서가 섞이지 않는다.
  async function extractImages(file, displayPath, options = {}) {
    const signal = options.signal;
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
    const entries = await readEntries(file);
    const imageEntries = entries.filter(
      (entry) =>
        !entry.name.endsWith("/") &&
        IMAGE_FILE_PATTERN.test(entry.name) &&
        !isJunkEntry(entry.name)
    );

    const pages = [];
    let encryptedCount = 0;
    let unsupportedCount = 0;

    try {
      for (let i = 0; i < imageEntries.length; i += 1) {
        signal?.throwIfAborted();
        const entry = imageEntries[i];

        if (entry.isEncrypted) {
          encryptedCount += 1;
          continue;
        }
        if (
          entry.compressionMethod !== COMPRESSION_STORED &&
          entry.compressionMethod !== COMPRESSION_DEFLATE
        ) {
          unsupportedCount += 1;
          continue;
        }

        onProgress(`${displayPath} 읽는 중 (${i + 1}/${imageEntries.length})`);
        const blob = await readEntryBlob(file, entry);
        pages.push({
          name: `${displayPath}/${entry.name}`,
          url: URL.createObjectURL(blob)
        });
      }
      signal?.throwIfAborted();
    } catch (error) {
      for (const page of pages) URL.revokeObjectURL(page.url);
      throw error;
    }

    if (!pages.length && encryptedCount) {
      throw new Error(`${displayPath}: 암호가 걸린 ZIP은 열 수 없습니다.`);
    }
    if (!pages.length && unsupportedCount) {
      throw new Error(`${displayPath}: 지원하지 않는 압축 방식입니다. 일반 ZIP으로 다시 압축해 주세요.`);
    }

    return pages;
  }

  globalThis.__dcmvLocalZipReader = { extractImages };
})();
