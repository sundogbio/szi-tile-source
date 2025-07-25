class m {
  /**
   * Create the remote file by fetching its size using a head request
   *
   * @param url url of the file that we eventually want to read
   * @param fetchOptions options to apply to all fetches,
   * @param fetchOptions.mode cors mode to use
   * @param fetchOptions.credentials whether to send credentials
   * @param fetchOptions.headers additional headers to add to all requests
   * @returns {Promise<RemoteFile>}
   */
  static create = async (t, e) => {
    const r = await this.fetchContentLength(t, e);
    return new m(t, r, e);
  };
  static fetchContentLength = async (t, e) => {
    try {
      const r = await fetch(t, {
        method: "HEAD",
        headers: e.headers,
        mode: e.mode,
        credentials: e.credentials
      });
      if (!r.ok)
        throw new Error(`HTTP error! Status: ${r.status}`);
      const n = r.headers.get("content-length");
      if (!n)
        throw new Error("Couldn't get content length from headers");
      return parseInt(n, 10);
    } catch (r) {
      throw console.error("Error getting file size:", r), r;
    }
  };
  constructor(t, e, r) {
    this.url = t, this.size = e, this.fetchOptions = r;
  }
  /**
   * Fetch the range of bytes specified. Note that end is *exclusive*, though the header
   * expects *inclusive* values. This removes the need to continually subtract 1 from
   * the more usual end-exclusive values used elsewhere.
   *
   * @param start inclusive start of range to fetch
   * @param end exclusive start of range to fetch
   * @param abortSignal AbortController signal, optionally specify this if you might want to
   *        abort the request
   * @throws Error if the start or end lie outside the file, or if start > end. Also throws
   *         an error if the request fails with anything other than a status between 200 and
   *         299.
   */
  fetchRange = async (t, e, r) => {
    if (t < 0 || t > this.size)
      throw new Error(`Start of fetch range (${t}) out of bounds (0 - ${this.size})!`);
    if (e < 0 || e > this.size)
      throw new Error(`Start of fetch range (${t}) out of bounds (0 - ${this.size})!`);
    if (t > e)
      throw new Error(`Start of fetch range (${t}) greater than end (${e})!`);
    const n = `bytes=${t}-${e - 1}`, i = this.fetchOptions.headers ? { ...this.fetchOptions.headers, Range: n } : { Range: n }, a = await fetch(this.url, {
      headers: i,
      signal: r,
      mode: this.fetchOptions.mode,
      credentials: this.fetchOptions.credentials
    });
    if (!a.ok)
      throw new Error(`Couldn't fetch range ${t}:${e} of ${url} of ${a.status}`);
    return await a.arrayBuffer();
  };
}
class l {
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
    const r = new Uint8Array(this.buffer, this.pos, t);
    return this.pos = e, r;
  }
  skip(t) {
    const e = this.pos + t;
    this.checkBounds(e), this.pos = e;
  }
}
const f = 4294967295, w = 65535, y = w, S = 22, U = 20, O = 1, z = 101010256, D = 117853008, L = 101075792, R = 33639248, I = 67324752;
function $(o, t) {
  if (t.length > o.length)
    return -1;
  for (let e = o.length - t.length; e > -1; e--) {
    let r = !0;
    for (let n = 0; n < t.length && r; n++)
      o.at(e + n) !== t.at(n) && (r = !1);
    if (r)
      return e;
  }
  return -1;
}
function k(o) {
  const t = new Uint8Array(4);
  return new DataView(t.buffer).setUint32(0, z, !0), t;
}
function v(o) {
  const t = $(new Uint8Array(o), k());
  if (t === -1)
    throw new Error("Invalid SZI file, no End Of Central Directory Record found");
  return t;
}
function x(o, t) {
  const e = new l(o);
  if (e.skip(t), e.readUint32() !== z)
    throw new Error("Invalid SZI file: End Of Central Directory Record has unexpected magic number");
  e.readUint16(), e.readUint16(), e.readUint16();
  const n = e.readUint16(), i = e.readUint32(), a = e.readUint32(), s = e.readUint16();
  return s > 0 && e.readUtf8String(s), { totalEntries: n, centralDirectorySize: i, centralDirectoryOffset: a };
}
function B(o, t) {
  const e = new l(o);
  if (e.skip(t), e.readUint32() !== D)
    throw new Error("Invalid SZI file: Zip64 End Of Central Directory Locator has unexpected magic number");
  e.readUint32();
  const n = e.readUint64();
  return e.readUint32(), { zip64EocdOffset: n };
}
function C(o, t) {
  const e = new l(o);
  if (e.skip(t), e.readUint32() !== L)
    throw new Error("Invalid SZI file: Zip64 End Of Central Directory Record has unexpected magic number");
  const n = e.readUint64() + 12;
  e.readUint16(), e.readUint16(), e.readUint32(), e.readUint32(), e.readUint64();
  const i = e.readUint64(), a = e.readUint64(), s = e.readUint64(), c = n - e.pos - t;
  return e.skip(c), { totalEntries: i, centralDirectorySize: a, centralDirectoryOffset: s };
}
function N(o, t, e) {
  let { compressedSize: r, uncompressedSize: n, diskNumberStart: i, relativeOffsetOfLocalHeader: a } = e;
  const s = o.pos;
  for (; o.pos - s < t; ) {
    const c = o.readUint16(), d = o.readUint16();
    c === O ? (n === f && (n = o.readUint64()), r === f && (r = o.readUint64()), a === f && (a = o.readUint64()), i === w && (i = o.readUint32())) : o.skip(d);
  }
  return {
    compressedSize: r,
    uncompressedSize: n,
    diskNumberStart: i,
    relativeOffsetOfLocalHeader: a
  };
}
function A(o, t) {
  const e = new l(o), r = [];
  for (let n = 0; n < t; n++) {
    if (e.readUint32() !== R)
      throw new Error(`Invalid SZI file: Central Directory Header ${n} has unexpected magic number`);
    e.readUint16(), e.readUint16(), e.readUint16(), e.readUint16(), e.readUint16(), e.readUint16(), e.readUint32();
    const a = e.readUint32(), s = e.readUint32(), c = e.readUint16(), d = e.readUint16(), u = e.readUint16(), E = e.readUint16();
    e.readUint16(), e.readUint32();
    const b = e.readUint32(), g = e.readUtf8String(c);
    if (a !== s)
      throw new Error(
        `Invalid SZI file: compressedSize: ${a} and uncompressedSize: ${s} don't match for ${g}!`
      );
    const h = N(e, d, {
      compressedSize: a,
      uncompressedSize: s,
      diskNumberStart: E,
      relativeOffsetOfLocalHeader: b
    });
    e.readUtf8String(u), r.push({
      compressedSize: h.compressedSize,
      uncompressedSize: h.uncompressedSize,
      relativeOffsetOfLocalHeader: h.relativeOffsetOfLocalHeader,
      filename: g
    });
  }
  return r;
}
async function F(o) {
  const t = o.size - (U + S + y), e = await o.fetchRange(Math.max(0, t), o.size), r = v(e), { totalEntries: n, centralDirectoryOffset: i, centralDirectorySize: a } = x(e, r);
  if (n === w || i === f || a === f) {
    const c = r - U, d = B(e, c), u = await o.fetchRange(
      d.zip64EocdOffset,
      t + c
    );
    return C(u, 0);
  } else
    return { totalEntries: n, centralDirectoryOffset: i, centralDirectorySize: a };
}
function H(o, t) {
  const e = /* @__PURE__ */ new Map(), r = o.toSorted(
    (i, a) => a.relativeOffsetOfLocalHeader - i.relativeOffsetOfLocalHeader
  );
  let n = t;
  for (const i of r) {
    const a = i.relativeOffsetOfLocalHeader;
    e.set(i.filename, {
      start: a,
      maxEnd: n,
      bodyLength: i.uncompressedSize
    }), n = a;
  }
  return e;
}
async function Z(o) {
  const { totalEntries: t, centralDirectoryOffset: e, centralDirectorySize: r } = await F(o), n = await o.fetchRange(e, e + r), i = A(n, t);
  return H(i, e);
}
class p {
  static create = async (t) => {
    const e = await Z(t);
    return new p(t, e);
  };
  constructor(t, e) {
    this.sziFile = t, this.contents = e;
  }
  fetchFileBody = async (t, e) => {
    const r = this.contents.get(t);
    if (!r)
      throw new Error(`${t} is not present inside this .szi file`);
    const n = await this.sziFile.fetchRange(r.start, r.maxEnd, e), i = new l(n, 0);
    if (i.readUint32() !== I)
      throw new Error(`Invalid SZI file: Local Header for ${t} has unexpected magic number`);
    i.readUint16(), i.readUint16(), i.readUint16(), i.readUint16(), i.readUint16(), i.readUint32(), i.readUint32(), i.readUint32();
    const s = i.readUint16(), c = i.readUint16(), d = i.readUtf8String(s);
    if (d !== t)
      throw new Error(`Trying to read ${t} but actually got ${d}`);
    return i.skip(c), i.readUint8Array(r.bodyLength);
  };
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
  tilesDirectory = () => {
    const e = this.dziFilename().split("/")[0];
    return `${e}/${e}_files/`;
  };
}
const T = (o) => {
  class t extends o.DziTileSource {
    /**
     * Create an SZI tile source for use with OpenSeadragon.
     *
     * @param url location of the SZI file we want to read
     * @param fetchOptions options to use when making HTTP requests to fetch parts of the file
     * @param fetchOptions.mode cors mode to use. Note that "no-cors" is not accepted, as it breaks Range requests.
     *        (See: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#making_cross-origin_requests)
     * @param fetchOptions.credentials when and how to pass credentials
     *        (see:https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#including_credentials)
     * @param fetchOptions.headers additional HTTP headers to send with each request
     * @returns {Promise<SziTileSource>}
     */
    static createSziTileSource = async (r, n = {}) => {
      if (n && n.mode === "no-cors")
        throw new Error("'no-cors' mode is not supported, as Range headers don't work with it");
      const i = await m.create(r, n), a = await p.create(i), s = await this.readOptionsFromDziXml(a);
      return new t(a, s);
    };
    static async readOptionsFromDziXml(r) {
      const n = r.dziFilename(), i = await r.fetchFileBody(n), a = new TextDecoder().decode(i), s = o.parseXml(a);
      return o.DziTileSource.prototype.configure(s, n, "");
    }
    constructor(r, n) {
      super(n), this.remoteSziReader = r;
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
    downloadTileStart = (r) => {
      const n = new Image();
      n.onload = function() {
        i(), r.finish(n, r.userData.request, null);
      }, n.onabort = n.onerror = function() {
        i(), r.finish(null, r.userData.request, "Image load aborted.");
      };
      const i = () => {
        n.onload = n.onerror = n.onabort = null;
      };
      r.userData.image = n, r.userData.abortController = new AbortController(), this.remoteSziReader.fetchFileBody(r.src, r.userData.abortController.signal).then(
        (a) => {
          const s = new Blob([a]);
          s.size === 0 ? (i(), r.finish(null, null, "Empty image!")) : n.src = (window.URL || window.webkitURL).createObjectURL(s);
        },
        (a) => {
          i(), r.finish(null, null, "Download failed: " + a.message);
        }
      );
    };
    /**
     * Provide means of aborting the execution.
     * Note that if you override this function, you should override also downloadTileStart().
     * @param {ImageJob} context job, the same object as with downloadTileStart(..)
     * @param {*} [context.userData] - Empty object to attach (and mainly read) your own data.
     */
    downloadTileAbort = (r) => {
      const n = r.userData.abortController;
      n && n.abort();
      const i = r.userData.image;
      i && (i.onload = i.onerror = i.onabort = null);
    };
  }
  o.SziTileSource = t;
};
(function(o, t) {
  typeof exports > "u" || typeof o.OpenSeadragon < "u" && t(o.OpenSeadragon);
})(typeof window < "u" ? window : void 0, T);
export {
  T as enableSziTileSource
};
