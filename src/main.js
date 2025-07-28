import { RemoteFile } from './remoteFile.js';
import { SziFileReader } from './sziFileReader.js';

export const enableSziTileSource = (OpenSeadragon) => {
  /**
   * SZI Tile Source that enables OpenSeadragon to load remote SZI files.
   *
   * This a relatively small extension of the DziTileSource, with a large part of the difference being at the
   * initialisation stage. The need to do this initialisation asynchronously combined with the need to do superclass
   * initialisation means that the class has a static factory constructor that must be called explicitly by the
   * user, as opposed to relying on OSD creating instances automatically in response to its configuration settings.
   *
   * For more on how to use this Tile Source see the
   * [README.md]{@link https://github.com/sundogbio/szi-tile-source/blob/main/README.md#usage}
   */
  class SziTileSource extends OpenSeadragon.DziTileSource {
    /**
     * Create an SZI tile source for use with OpenSeadragon. This static factory constructor should be used
     * instead of the standard Construct, as the majority of the configuration of the image source happens
     * here asynchronously.
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
    static createSziTileSource = async (url, fetchOptions = {}) => {
      if (fetchOptions && fetchOptions.mode === 'no-cors') {
        throw new Error("'no-cors' mode is not supported, as Range headers don't work with it");
      }

      const remoteSziFile = await RemoteFile.create(url, fetchOptions);
      const remoteSziReader = await SziFileReader.create(remoteSziFile);

      const options = await this.readOptionsFromDziXml(remoteSziReader);

      return new SziTileSource(remoteSziReader, options);
    };

    static async readOptionsFromDziXml(remoteSziReader) {
      const dziFilename = remoteSziReader.dziFilename();
      const dziUint8Buffer = await remoteSziReader.fetchFileBody(dziFilename);
      const dziXmlText = new TextDecoder().decode(dziUint8Buffer);
      const dziXml = OpenSeadragon.parseXml(dziXmlText);
      return OpenSeadragon.DziTileSource.prototype.configure(dziXml, dziFilename, '');
    }

    /**
     * Do not call this directly, for internal use only!
     *
     * @param remoteSziReader
     * @param options
     */
    constructor(remoteSziReader, options) {
      super(options);
      this.remoteSziReader = remoteSziReader;
    }

    /**
     * Download tile data. Intended for use by OSD, not end users!
     *
     * This is a cut down implementation of the XML-specific path of TileSource.Download
     * that instead of calling makeAjaxRequest uses the remoteSziFileReader.
     *
     * Note that this ignores all the Ajax options as the remoteSziReader uses the fetchOptions supplied in
     * the createSziTileSourceInstead. Also note that only the documented parts of context are used below.
     *
     * @param {ImageJob} context job context that you have to call finish(...) on.
     * @param {String} [context.src] - URL of image to download.
     * @param {*} [context.userData] - Empty object to attach your own data and helper variables to.
     * @param {Function} [context.finish] - Should be called unless abort() was executed, e.g. on all occasions,
     */
    downloadTileStart = (context) => {
      const image = new Image();
      image.onload = function () {
        resetImageHandlers();
        context.finish(image, context.userData.request, null);
      };
      image.onabort = image.onerror = function () {
        resetImageHandlers();
        context.finish(null, context.userData.request, 'Image load aborted.');
      };

      const resetImageHandlers = () => {
        image.onload = image.onerror = image.onabort = null;
      };

      context.userData.image = image;
      context.userData.abortController = new AbortController();

      this.remoteSziReader.fetchFileBody(context.src, context.userData.abortController.signal).then(
        (arrayBuffer) => {
          const imageBlob = new Blob([arrayBuffer]);
          if (imageBlob.size === 0) {
            resetImageHandlers();
            context.finish(null, null, 'Empty image!');
          } else {
            // Turn the blob into an image,
            // When this completes it will trigger finish via the onLoad method of the image
            image.src = (window.URL || window.webkitURL).createObjectURL(imageBlob);
          }
        },
        (error) => {
          resetImageHandlers();
          context.finish(null, null, 'Download failed: ' + error.message);
        },
      );
    };

    /**
     * Provide means of aborting the execution. Intended for use by OSD, not end users!
     *
     * @param {ImageJob} context job, the same object as with downloadTileStart(..)
     * @param {*} [context.userData] - Empty object to attach (and mainly read) your own data.
     */
    downloadTileAbort = (context) => {
      const abortController = context.userData.abortController;
      if (abortController) {
        abortController.abort();
      }
      const image = context.userData.image;
      if (image) {
        image.onload = image.onerror = image.onabort = null;
      }
    };
  }

  OpenSeadragon.SziTileSource = SziTileSource;
};

(function (global, factory) {
  // Skip if currently in ESM mode
  if (typeof exports === 'undefined') {
    return;
  }

  // Check if OpenSeadragon is available
  if (typeof global.OpenSeadragon !== 'undefined') {
    // Attach the SziTileSource to the OpenSeadragon namespace
    factory(global.OpenSeadragon);
  }
})(typeof window !== 'undefined' ? window : this, enableSziTileSource);
