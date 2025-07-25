class h {
  /**
   * Create the remote file by fetching its size using a head request
   *
   * @param {string} url url of the file that we eventually want to read
   * @param fetchOptions options to apply to all fetches,
   * @param {string} fetchOptions.mode cors mode to use
   * @param {string} fetchOptions.credentials whether to send credentials
   * @param {Object} fetchOptions.headers additional headers to add to all requests
   * @returns {Promise<RemoteFile>}
   */
  static create = async (t, e) => {
    const n = await this.fetchFileSize(t, e);
    return new h(t, n, e);
  };
  /**
   * Attempt to fetch the size of the remote file by doing a HEAD request and reading
   * the content-length header
   *
   * @param {string} url
   * @param fetchOptions options to apply to all fetches,
   * @param {string} fetchOptions.mode cors mode to use
   * @param {string} fetchOptions.credentials whether to send credentials
   * @param {Object} fetchOptions.headers additional headers to add to all requests
   * @returns {Promise<number>}
   */
  static fetchFileSize = async (t, e) => {
    const n = await fetch(t, {
      method: "HEAD",
      headers: e.headers,
      mode: e.mode,
      credentials: e.credentials
    });
    if (!n.ok)
      throw new Error(`Could not fetch size of ${t}, response status for HEAD request: ${n.status}`);
    const i = n.headers.get("content-length");
    if (!i)
      throw new Error(`Could not fetch size of ${t}, no content-length in response headers`);
    return parseInt(i, 10);
  };
  constructor(t, e, n) {
    this.url = t, this.size = e, this.fetchOptions = n;
  }
  /**
   * Fetch the range of bytes specified. Note that end is *exclusive*, though the header
   * expects *inclusive* values. This removes the need to continually subtract 1 from
   * the more usual end-exclusive values used elsewhere.
   *
   * @param {number} start inclusive start of range to fetch
   * @param {number} end exclusive start of range to fetch
   * @param {AbortSignal }abortSignal AbortController signal, optionally specify this if you might want to
   *        abort the request
   * @throws Error if the start or end lie outside the file, or if start > end. Also throws
   *         an error if the request fails with anything other than a status between 200 and
   *         299.
   */
  fetchRange = async (t, e, n) => {
    if (t < 0 || t > this.size)
      throw new Error(`Start of fetch range (${t}) out of bounds (0 - ${this.size})!`);
    if (e < 0 || e > this.size)
      throw new Error(`Start of fetch range (${t}) out of bounds (0 - ${this.size})!`);
    if (t > e)
      throw new Error(`Start of fetch range (${t}) greater than end (${e})!`);
    const i = `bytes=${t}-${e - 1}`, r = this.fetchOptions.headers ? { ...this.fetchOptions.headers, Range: i } : { Range: i }, a = await fetch(this.url, {
      headers: r,
      signal: n,
      mode: this.fetchOptions.mode,
      credentials: this.fetchOptions.credentials
    });
    if (!a.ok)
      throw new Error(`Couldn't fetch range ${t}:${e} of ${url} of ${a.status}`);
    return await a.arrayBuffer();
  };
}
class u {
  constructor(t) {
    this.buffer = t, this.view = new DataView(t), this.pos = 0;
  }
  checkBounds(t) {
    if (t < 0)
      throw new Error("Trying to move before start of buffer");
    if (t > this.buffer.byteLength)
      throw new Error("Trying to move after end of buffer");
  }
  readUint16() {
    const t = this.pos + 2;
    this.checkBounds(t);
    const e = this.view.getUint16(this.pos, !0);
    return this.pos = t, e;
  }
  readUint32() {
    const t = this.pos + 4;
    this.checkBounds(t);
    const e = this.view.getUint32(this.pos, !0);
    return this.pos = t, e;
  }
  readUint64() {
    const t = this.pos + 8;
    this.checkBounds(t);
    const e = this.view.getBigUint64(this.pos, !0);
    if (this.pos = t, e > Number.MAX_SAFE_INTEGER)
      throw new Error("Only values upto 2^53 - 1 are supported!");
    return Number(e);
  }
  readUtf8String(t) {
    const e = this.readUint8Array(t);
    return new TextDecoder().decode(e);
  }
  readUint8Array(t) {
    const e = this.pos + t;
    this.checkBounds(e);
    const n = new Uint8Array(this.buffer, this.pos, t);
    return this.pos = e, n;
  }
  skip(t) {
    const e = this.pos + t;
    this.checkBounds(e), this.pos = e;
  }
}
const l = 4294967295, m = 65535, S = m, z = 22, U = 20, D = 1, b = 101010256, O = 117853008, L = 101075792, R = 33639248, A = 67324752;
function $(o, t, e) {
  if (e.length > o.length)
    return -1;
  t = Math.min(t, o.length - e.length);
  for (let n = t; n > -1; n--) {
    let i = !0;
    for (let r = 0; r < e.length && i; r++)
      o.at(n + r) !== e.at(r) && (i = !1);
    if (i)
      return n;
  }
  return -1;
}
function I(o) {
  const t = new Uint8Array(4);
  return new DataView(t.buffer).setUint32(0, b, !0), t;
}
function k(o) {
  const t = new Uint8Array(o), e = I();
  let n = o.byteLength - z;
  for (; n >= 0; ) {
    const i = $(t, n, e);
    if (i === -1)
      throw new Error("Invalid SZI file, no valid End Of Central Directory Record found");
    const r = new u(o);
    if (r.skip(i), r.readUint32() !== b)
      throw new Error("Programming Error: End Of Central Directory Record has unexpected magic number");
    r.readUint16(), r.readUint16(), r.readUint16();
    const s = r.readUint16(), c = r.readUint32(), d = r.readUint32(), f = r.readUint16();
    if (r.pos + f === o.byteLength)
      return f > 0 && r.readUtf8String(f), { totalEntries: s, centralDirectorySize: c, centralDirectoryOffset: d, startOfEocdInBuffer: i };
    n = i - 1;
  }
  if (n < 0)
    throw new Error("Invalid SZI file, no End Of Central Directory Record found");
}
function v(o, t) {
  const e = new u(o);
  if (e.skip(t), e.readUint32() !== O)
    throw new Error("Invalid SZI file: Zip64 End Of Central Directory Locator has unexpected magic number");
  e.readUint32();
  const i = e.readUint64();
  return e.readUint32(), { zip64EocdOffset: i };
}
function x(o, t) {
  const e = new u(o);
  if (e.skip(t), e.readUint32() !== L)
    throw new Error("Invalid SZI file: Zip64 End Of Central Directory Record has unexpected magic number");
  const i = e.readUint64() + 12;
  e.readUint16(), e.readUint16(), e.readUint32(), e.readUint32(), e.readUint64();
  const r = e.readUint64(), a = e.readUint64(), s = e.readUint64(), c = i - e.pos - t;
  return e.skip(c), { totalEntries: r, centralDirectorySize: a, centralDirectoryOffset: s };
}
function C(o, t, e) {
  let { compressedSize: n, uncompressedSize: i, diskNumberStart: r, relativeOffsetOfLocalHeader: a } = e;
  const s = o.pos;
  for (; o.pos - s < t; ) {
    const c = o.readUint16(), d = o.readUint16();
    c === D ? (i === l && (i = o.readUint64()), n === l && (n = o.readUint64()), a === l && (a = o.readUint64()), r === m && (r = o.readUint32())) : o.skip(d);
  }
  return {
    compressedSize: n,
    uncompressedSize: i,
    diskNumberStart: r,
    relativeOffsetOfLocalHeader: a
  };
}
function N(o, t) {
  const e = new u(o), n = [];
  for (let i = 0; i < t; i++) {
    if (e.readUint32() !== R)
      throw new Error(`Invalid SZI file: Central Directory Header ${i} has unexpected magic number`);
    e.readUint16(), e.readUint16(), e.readUint16(), e.readUint16(), e.readUint16(), e.readUint16(), e.readUint32();
    const a = e.readUint32(), s = e.readUint32(), c = e.readUint16(), d = e.readUint16(), f = e.readUint16(), E = e.readUint16();
    e.readUint16(), e.readUint32();
    const y = e.readUint32(), p = e.readUtf8String(c);
    if (a !== s)
      throw new Error(
        `Invalid SZI file: compressedSize: ${a} and uncompressedSize: ${s} don't match for ${p}!`
      );
    const g = C(e, d, {
      compressedSize: a,
      uncompressedSize: s,
      diskNumberStart: E,
      relativeOffsetOfLocalHeader: y
    });
    e.readUtf8String(f), n.push({
      uncompressedSize: g.uncompressedSize,
      relativeOffsetOfLocalHeader: g.relativeOffsetOfLocalHeader,
      filename: p
    });
  }
  return n;
}
async function B(o) {
  const t = Math.max(0, o.size - (U + z + S)), e = await o.fetchRange(t, o.size), { totalEntries: n, centralDirectoryOffset: i, centralDirectorySize: r, startOfEocdInBuffer: a } = k(e);
  if (n === m || i === l || r === l) {
    const c = a - U, d = v(e, c), f = await o.fetchRange(
      d.zip64EocdOffset,
      t + c
    );
    return x(f, 0);
  } else
    return { totalEntries: n, centralDirectoryOffset: i, centralDirectorySize: r };
}
function F(o, t) {
  const e = /* @__PURE__ */ new Map(), n = o.toSorted(
    (r, a) => a.relativeOffsetOfLocalHeader - r.relativeOffsetOfLocalHeader
  );
  let i = t;
  for (const r of n) {
    const a = r.relativeOffsetOfLocalHeader;
    e.set(r.filename, {
      start: a,
      maxEnd: i,
      bodyLength: r.uncompressedSize
    }), i = a;
  }
  return e;
}
async function H(o) {
  const { totalEntries: t, centralDirectoryOffset: e, centralDirectorySize: n } = await B(o), i = await o.fetchRange(e, e + n), r = N(i, t);
  return F(r, e);
}
class w {
  /**
   * Asynchronously create an instance of a reader for the supplied SZI remote file
   * @param {RemoteFile} sziFile
   * @returns {Promise<SziFileReader>}
   */
  static create = async (t) => {
    const e = await H(t);
    return new w(t, e);
  };
  constructor(t, e) {
    this.sziFile = t, this.contents = e;
  }
  /**
   * Read the body of the filename contained in the SZI file
   *
   * @param {string} filename filename whose body you want to read
   * @param {AbortSignal} abortSignal AbortController.signal for cancelling the request
   * @returns {Promise<Uint8Array>} The body of the file specified
   */
  fetchFileBody = async (t, e) => {
    const n = this.contents.get(t);
    if (!n)
      throw new Error(`${t} is not present inside this .szi file`);
    const i = await this.sziFile.fetchRange(n.start, n.maxEnd, e), r = new u(i, 0);
    if (r.readUint32() !== A)
      throw new Error(`Invalid SZI file: Local Header for ${t} has unexpected magic number`);
    r.readUint16(), r.readUint16(), r.readUint16(), r.readUint16(), r.readUint16(), r.readUint32(), r.readUint32(), r.readUint32();
    const s = r.readUint16(), c = r.readUint16(), d = r.readUtf8String(s);
    if (d !== t)
      throw new Error(`Trying to read ${t} but actually got ${d}`);
    return r.skip(c), r.readUint8Array(n.bodyLength);
  };
  /**
   * Find the filename of the .dzi config file inside the contents
   *
   * @returns {string}
   */
  dziFilename = () => {
    let t = "";
    for (const e of this.contents.keys())
      if (e.match(/^([^\/]*)\/\1\.dzi$/)) {
        if (t)
          throw new Error("Multiple .dzi files found in .szi!");
        t = e;
      }
    if (!t)
      throw new Error("No dzi file found in .szi!");
    return t;
  };
  /**
   * Find the top level tiles directory. This should be of the form
   * <name>/<name>_files, and contain subdirectories containing tiles
   * for each zoom level
   *
   * @returns {string}
   */
  tilesDirectory = () => {
    const e = this.dziFilename().split("/")[0];
    return `${e}/${e}_files/`;
  };
}
const Z = (o) => {
  class t extends o.DziTileSource {
    /**
     * Create an SZI tile source for use with OpenSeadragon.
     *
     * @param {string} url location of the SZI file we want to read
     * @param fetchOptions options to use when making HTTP requests to fetch parts of the file
     * @param fetchOptions.mode cors mode to use. Note that "no-cors" is not accepted, as it breaks Range requests.
     *        (See: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#making_cross-origin_requests)
     * @param fetchOptions.credentials when and how to pass credentials
     *        (see:https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#including_credentials)
     * @param fetchOptions.headers additional HTTP headers to send with each request
     * @returns {Promise<SziTileSource>}
     */
    static createSziTileSource = async (n, i = {}) => {
      if (i && i.mode === "no-cors")
        throw new Error("'no-cors' mode is not supported, as Range headers don't work with it");
      const r = await h.create(n, i), a = await w.create(r), s = await this.readOptionsFromDziXml(a);
      return new t(a, s);
    };
    static async readOptionsFromDziXml(n) {
      const i = n.dziFilename(), r = await n.fetchFileBody(i), a = new TextDecoder().decode(r), s = o.parseXml(a);
      return o.DziTileSource.prototype.configure(s, i, "");
    }
    constructor(n, i) {
      super(i), this.remoteSziReader = n;
    }
    /**
     * Download tile data. This is a cut down implementation of the XML-specific path of TileSource.Download
     * that instead of calling makeAjaxRequest, uses the remoteSziFileReader instead.
     *
     * Note that this ignores all the Ajax options as the remoteSziReader uses the fetchOptions supplied in
     * the createSziTileSourceInstead. Also note that only the documented parts of context are used below.
     *
     * @param {ImageJob} context job context that you have to call finish(...) on.
     * @param {String} [context.src] - URL of image to download.
     * @param {*} [context.userData] - Empty object to attach your own data and helper variables to.
     * @param {Function} [context.finish] - Should be called unless abort() was executed, e.g. on all occasions,
     */
    downloadTileStart = (n) => {
      const i = new Image();
      i.onload = function() {
        r(), n.finish(i, n.userData.request, null);
      }, i.onabort = i.onerror = function() {
        r(), n.finish(null, n.userData.request, "Image load aborted.");
      };
      const r = () => {
        i.onload = i.onerror = i.onabort = null;
      };
      n.userData.image = i, n.userData.abortController = new AbortController(), this.remoteSziReader.fetchFileBody(n.src, n.userData.abortController.signal).then(
        (a) => {
          const s = new Blob([a]);
          s.size === 0 ? (r(), n.finish(null, null, "Empty image!")) : i.src = (window.URL || window.webkitURL).createObjectURL(s);
        },
        (a) => {
          r(), n.finish(null, null, "Download failed: " + a.message);
        }
      );
    };
    /**
     * Provide means of aborting the execution.
     * Note that if you override this function, you should override also downloadTileStart().
     * @param {ImageJob} context job, the same object as with downloadTileStart(..)
     * @param {*} [context.userData] - Empty object to attach (and mainly read) your own data.
     */
    downloadTileAbort = (n) => {
      const i = n.userData.abortController;
      i && i.abort();
      const r = n.userData.image;
      r && (r.onload = r.onerror = r.onabort = null);
    };
  }
  o.SziTileSource = t;
};
(function(o, t) {
  typeof exports > "u" || typeof o.OpenSeadragon < "u" && t(o.OpenSeadragon);
})(typeof window < "u" ? window : void 0, Z);
export {
  Z as enableSziTileSource
};
