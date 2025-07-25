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
      const i = r.headers.get("content-length");
      if (!i)
        throw new Error("Couldn't get content length from headers");
      return parseInt(i, 10);
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
    const i = `bytes=${t}-${e - 1}`, n = this.fetchOptions.headers ? { ...this.fetchOptions.headers, Range: i } : { Range: i }, a = await fetch(this.url, {
      headers: n,
      signal: r,
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
    const r = new Uint8Array(this.buffer, this.pos, t);
    return this.pos = e, r;
  }
  skip(t) {
    const e = this.pos + t;
    this.checkBounds(e), this.pos = e;
  }
}
const l = 4294967295, w = 65535, S = w, z = 22, U = 20, O = 1, b = 101010256, D = 117853008, L = 101075792, R = 33639248, A = 67324752;
function I(o, t, e) {
  if (e.length > o.length)
    return -1;
  t = Math.min(t, o.length - e.length);
  for (let r = t; r > -1; r--) {
    let i = !0;
    for (let n = 0; n < e.length && i; n++)
      o.at(r + n) !== e.at(n) && (i = !1);
    if (i)
      return r;
  }
  return -1;
}
function $(o) {
  const t = new Uint8Array(4);
  return new DataView(t.buffer).setUint32(0, b, !0), t;
}
function k(o) {
  const t = new Uint8Array(o), e = $();
  let r = o.byteLength - z;
  for (; r >= 0; ) {
    const i = I(t, r, e);
    if (i === -1)
      throw new Error("Invalid SZI file, no valid End Of Central Directory Record found");
    const n = new u(o);
    if (n.skip(i), n.readUint32() !== b)
      throw new Error("Programming Error: End Of Central Directory Record has unexpected magic number");
    n.readUint16(), n.readUint16(), n.readUint16();
    const s = n.readUint16(), c = n.readUint32(), d = n.readUint32(), f = n.readUint16();
    if (n.pos + f === o.byteLength)
      return f > 0 && n.readUtf8String(f), { totalEntries: s, centralDirectorySize: c, centralDirectoryOffset: d, startOfEocdInBuffer: i };
    r = i - 1;
  }
  if (r < 0)
    throw new Error("Invalid SZI file, no End Of Central Directory Record found");
}
function v(o, t) {
  const e = new u(o);
  if (e.skip(t), e.readUint32() !== D)
    throw new Error("Invalid SZI file: Zip64 End Of Central Directory Locator has unexpected magic number");
  e.readUint32();
  const i = e.readUint64();
  return e.readUint32(), { zip64EocdOffset: i };
}
function C(o, t) {
  const e = new u(o);
  if (e.skip(t), e.readUint32() !== L)
    throw new Error("Invalid SZI file: Zip64 End Of Central Directory Record has unexpected magic number");
  const i = e.readUint64() + 12;
  e.readUint16(), e.readUint16(), e.readUint32(), e.readUint32(), e.readUint64();
  const n = e.readUint64(), a = e.readUint64(), s = e.readUint64(), c = i - e.pos - t;
  return e.skip(c), { totalEntries: n, centralDirectorySize: a, centralDirectoryOffset: s };
}
function x(o, t, e) {
  let { compressedSize: r, uncompressedSize: i, diskNumberStart: n, relativeOffsetOfLocalHeader: a } = e;
  const s = o.pos;
  for (; o.pos - s < t; ) {
    const c = o.readUint16(), d = o.readUint16();
    c === O ? (i === l && (i = o.readUint64()), r === l && (r = o.readUint64()), a === l && (a = o.readUint64()), n === w && (n = o.readUint32())) : o.skip(d);
  }
  return {
    compressedSize: r,
    uncompressedSize: i,
    diskNumberStart: n,
    relativeOffsetOfLocalHeader: a
  };
}
function N(o, t) {
  const e = new u(o), r = [];
  for (let i = 0; i < t; i++) {
    if (e.readUint32() !== R)
      throw new Error(`Invalid SZI file: Central Directory Header ${i} has unexpected magic number`);
    e.readUint16(), e.readUint16(), e.readUint16(), e.readUint16(), e.readUint16(), e.readUint16(), e.readUint32();
    const a = e.readUint32(), s = e.readUint32(), c = e.readUint16(), d = e.readUint16(), f = e.readUint16(), E = e.readUint16();
    e.readUint16(), e.readUint32();
    const y = e.readUint32(), g = e.readUtf8String(c);
    if (a !== s)
      throw new Error(
        `Invalid SZI file: compressedSize: ${a} and uncompressedSize: ${s} don't match for ${g}!`
      );
    const h = x(e, d, {
      compressedSize: a,
      uncompressedSize: s,
      diskNumberStart: E,
      relativeOffsetOfLocalHeader: y
    });
    e.readUtf8String(f), r.push({
      compressedSize: h.compressedSize,
      uncompressedSize: h.uncompressedSize,
      relativeOffsetOfLocalHeader: h.relativeOffsetOfLocalHeader,
      filename: g
    });
  }
  return r;
}
async function B(o) {
  const t = Math.max(0, o.size - (U + z + S)), e = await o.fetchRange(t, o.size), { totalEntries: r, centralDirectoryOffset: i, centralDirectorySize: n, startOfEocdInBuffer: a } = k(e);
  if (r === w || i === l || n === l) {
    const c = a - U, d = v(e, c), f = await o.fetchRange(
      d.zip64EocdOffset,
      t + c
    );
    return C(f, 0);
  } else
    return { totalEntries: r, centralDirectoryOffset: i, centralDirectorySize: n };
}
function H(o, t) {
  const e = /* @__PURE__ */ new Map(), r = o.toSorted(
    (n, a) => a.relativeOffsetOfLocalHeader - n.relativeOffsetOfLocalHeader
  );
  let i = t;
  for (const n of r) {
    const a = n.relativeOffsetOfLocalHeader;
    e.set(n.filename, {
      start: a,
      maxEnd: i,
      bodyLength: n.uncompressedSize
    }), i = a;
  }
  return e;
}
async function F(o) {
  const { totalEntries: t, centralDirectoryOffset: e, centralDirectorySize: r } = await B(o), i = await o.fetchRange(e, e + r), n = N(i, t);
  return H(n, e);
}
class p {
  static create = async (t) => {
    const e = await F(t);
    return new p(t, e);
  };
  constructor(t, e) {
    this.sziFile = t, this.contents = e;
  }
  fetchFileBody = async (t, e) => {
    const r = this.contents.get(t);
    if (!r)
      throw new Error(`${t} is not present inside this .szi file`);
    const i = await this.sziFile.fetchRange(r.start, r.maxEnd, e), n = new u(i, 0);
    if (n.readUint32() !== A)
      throw new Error(`Invalid SZI file: Local Header for ${t} has unexpected magic number`);
    n.readUint16(), n.readUint16(), n.readUint16(), n.readUint16(), n.readUint16(), n.readUint32(), n.readUint32(), n.readUint32();
    const s = n.readUint16(), c = n.readUint16(), d = n.readUtf8String(s);
    if (d !== t)
      throw new Error(`Trying to read ${t} but actually got ${d}`);
    return n.skip(c), n.readUint8Array(r.bodyLength);
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
const Z = (o) => {
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
    static createSziTileSource = async (r, i = {}) => {
      if (i && i.mode === "no-cors")
        throw new Error("'no-cors' mode is not supported, as Range headers don't work with it");
      const n = await m.create(r, i), a = await p.create(n), s = await this.readOptionsFromDziXml(a);
      return new t(a, s);
    };
    static async readOptionsFromDziXml(r) {
      const i = r.dziFilename(), n = await r.fetchFileBody(i), a = new TextDecoder().decode(n), s = o.parseXml(a);
      return o.DziTileSource.prototype.configure(s, i, "");
    }
    constructor(r, i) {
      super(i), this.remoteSziReader = r;
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
      const i = new Image();
      i.onload = function() {
        n(), r.finish(i, r.userData.request, null);
      }, i.onabort = i.onerror = function() {
        n(), r.finish(null, r.userData.request, "Image load aborted.");
      };
      const n = () => {
        i.onload = i.onerror = i.onabort = null;
      };
      r.userData.image = i, r.userData.abortController = new AbortController(), this.remoteSziReader.fetchFileBody(r.src, r.userData.abortController.signal).then(
        (a) => {
          const s = new Blob([a]);
          s.size === 0 ? (n(), r.finish(null, null, "Empty image!")) : i.src = (window.URL || window.webkitURL).createObjectURL(s);
        },
        (a) => {
          n(), r.finish(null, null, "Download failed: " + a.message);
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
      const i = r.userData.abortController;
      i && i.abort();
      const n = r.userData.image;
      n && (n.onload = n.onerror = n.onabort = null);
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
