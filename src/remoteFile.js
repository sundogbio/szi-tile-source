/**
 * Represents a remote file that we are going to try and read from
 */
export class RemoteFile {
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
  static create = async (url, fetchOptions) => {
    const size = await this.fetchContentLength(url, fetchOptions);
    return new RemoteFile(url, size, fetchOptions);
  };

  static fetchContentLength = async (url, fetchOptions) => {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: fetchOptions.headers,
        mode: fetchOptions.mode,
        credentials: fetchOptions.credentials,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      if (!contentLength) {
        throw new Error("Couldn't get content length from headers");
      }

      return parseInt(contentLength, 10);
    } catch (error) {
      console.error('Error getting file size:', error);
      throw error;
    }
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
   * @param start inclusive start of range to fetch
   * @param end exclusive start of range to fetch
   * @param abortSignal AbortController signal, optionally specify this if you might want to
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
      throw new Error(`Couldn't fetch range ${start}:${end} of ${url} of ${response.status}`);
    }

    return await response.arrayBuffer();
  };
}
