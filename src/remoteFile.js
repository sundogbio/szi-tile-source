/**
 * Represents a remote file that we are going to try and read from
 */
export class RemoteFile {
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
  static create = async (url, fetchOptions) => {
    const size = await this.fetchFileSize(url, fetchOptions);
    return new RemoteFile(url, size, fetchOptions);
  };

  /**
   * Attempt to fetch the size of the remote file by doing a minimal ranged GET request and reading
   * the Content-Range header
   *
   * @param {string} url
   * @param fetchOptions options to apply to all fetches,
   * @param {string} fetchOptions.mode cors mode to use
   * @param {string} fetchOptions.credentials whether to send credentials
   * @param {Object} fetchOptions.headers additional headers to add to all requests
   * @returns {Promise<number>}
   */
  static fetchFileSize = async (url, fetchOptions) => {
    const headers = fetchOptions.headers ? { ...fetchOptions.headers, Range: 'bytes=0-255' } : { Range: 'bytes=0-255' };

    const response = await fetch(url, {
      headers: headers,
      mode: fetchOptions.mode,
      credentials: fetchOptions.credentials,
    });

    if (!response.ok) {
      throw new Error(`Could not fetch size of ${url}, response status for request: ${response.status}`);
    }

    const contentRange = response.headers.get('Content-Range');
    if (!contentRange) {
      throw new Error(
        `Could not fetch size of ${url}, Content-Range header not included in response. ` +
          "Check that your server's CORS settings include it in Access-Control-Expose-Headers.",
      );
    }

    const [match, start, end, length] = contentRange.match(/bytes (\d+)\-(\d+)\/(\d+)/);
    if (!match || !length) {
      throw new Error(`Could not fetch size of ${url}, Content-Range header didn't contain the length of the file`);
    }

    return parseInt(length, 10);
  };

  constructor(url, size, fetchOptions) {
    this.url = url;
    this.size = size;
    this.fetchOptions = fetchOptions;
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
  fetchRange = async (start, end, abortSignal) => {
    if (start < 0 || start > this.size) {
      throw new Error(`Start of fetch range (${start}) out of bounds (0 - ${this.size})!`);
    }

    if (end < 0 || end > this.size) {
      throw new Error(`Start of fetch range (${start}) out of bounds (0 - ${this.size})!`);
    }

    if (start > end) {
      throw new Error(`Start of fetch range (${start}) greater than end (${end})!`);
    }

    const rangeHeaderValue = `bytes=${start}-${end - 1}`;
    const headers = this.fetchOptions.headers
      ? { ...this.fetchOptions.headers, Range: rangeHeaderValue }
      : { Range: rangeHeaderValue };

    const response = await fetch(this.url, {
      headers,
      signal: abortSignal,
      mode: this.fetchOptions.mode,
      credentials: this.fetchOptions.credentials,
    });

    if (!response.ok) {
      throw new Error(`Couldn't fetch range ${start}:${end} of ${this.url} status: ${response.status}`);
    }

    return await response.arrayBuffer();
  };
}
