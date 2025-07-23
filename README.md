# szi-tile-source

An [OpenSeadragon](https://openseadragon.github.io/) (OSD) TileSource for
[SZI](https://github.com/smartinmedia/SZI-Format) files, enabling loading of SZI files into
OpenSeadragon from any static webserver that supports
[Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests),
including S3-like services.

## Motivation

The [Deep Zoom Image](https://en.wikipedia.org/wiki/Deep_Zoom) (DZI) format is widely used as a way
of enabling smooth scrolling and zooming of very large images. It consists of a .dzi file specifying
metadata for the whole image and an accompanying data directory containing subsections of the image
(known as tiles) at a variety of different zoom images. This sort of *image pyramid* is very
efficient for serving up large images, but the potentially huge number of files involved means that
moving or deleting DZI objects can be tedious, slow, and expensive in environments where cheap bulk
operations aren't available. 

To counter this problem [Smart In Media](https://www.smartinmedia.com/) came up with the
[SZI](https://github.com/smartinmedia/SZI-Format) format, which wraps the DZI file structure up in a
single, uncompressed ZIP file. This choice of format obviously makes moving the tile images around a
lot easier, but it also allows users access to each individual tile image by looking up its location
in the ZIP file's Central Directory, and then reading the appropriate range of bytes directly out of
the file.

Unfortunately, reading the Central Directory from the file is a slightly involved process (see
below), and is impractical to do on every tile request. The intent of the authors of the SZI spec was
that any system serving up images from remotely stored SZIs would first generate a cacheable map file
of the SZI file before serving files, to enable rapid look up of the image tile locations. However,
this precludes the efficient use of simple static storage systems to serve up SZI files unless you
pre-process all the files to generate these maps and store them alongside the files themselves.

The aim of this project is to enable OpenSeadragon to read unprocessed SZI files from static storage
systems by transparently caching the Central Directory on the client side instead.

## Usage

### Installation and loading

The library currently isn't distributed anywhere, this will hopefully change soon! For now, you can
follow the instructions on [building for distribution below](#development), which should output two
files to the `dist` folder, which you can then copy to your own project. There is an old
school '.cjs' file available, but we recommend using the ES module file.

To make sure this loads correctly, as well as importing it you need to make sure to call
`enableSziTileSource` before first use. This creates the `SziTileSource` class as an extension of
`OpenSeadragon.DziTileSource` and places it in the `OpenSeadragon` namespace.

If you are using it inline, this will look something like this (with `dist` being replaced by the
location of the module file in your own project):

```html
    <script src="https://cdnjs.cloudflare.com/ajax/libs/openseadragon/5.0.1/openseadragon.js"></script>
    <script type="module" src="./dist/szi-tile-source.js"></script>
    <script type="module">
        import { enableSziTileSource } from "./dist/szi-tile-source.js";
        enableSziTileSource(OpenSeadragon);
    </script>

```

Alternatively, if you are using it an ES module, just the following is needed:

```js

    import { OpenSeadragon } from 'openseadragon.js';
    import { enableSziTileSource } from "./dist/szi-tile-source.js";
    enableSziTileSource(OpenSeadragon);

```


### Creating a TileSource

Unlike the TileSources that are bundled up with OpenSeadragon, the `SziTileSource` won't be 
automatically created by simply setting the URL of the viewer to point at a file ending in `.szi`.
Instead, you have to explicitly create it by calling the static, asynchronous `createSziTileSource`
constructor, and then pass the resulting object into the viewer's constructor, like so:

```html

    <div id="osd-szi-webp" class="osd"></div>
    <script type="module">
        const sziUrl = 'examples/zipped/mixmas-webp.szi';
        OpenSeadragon.SziTileSource.createSziTileSource(sziUrl).then(async tileSource => {
            const viewer = new OpenSeadragon.Viewer({
                id: "osd-szi-webp",
                prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/5.0.1/images/",
                tileSources: [tileSource],
            });

        })
    </script>
```

The only required argument to the constructor is the URL of the file.

### Options

All file downloads are done using the Fetch API, so the SziTileSource completely ignores any of the
OSD options to do with Ajax file download, including: `loadTilesWithAjax`, `ajaxHeaders`, 
`ajaxWithCredentials`, and `crossOriginPolicy`. 

Instead, it supports a simple `fetchOptions` parameter in its static constructor, where you can
specify `headers`, `mode`, and `credentials` properties that will be passed straight through to the
call to `fetch` - see the 
[Fetch API Mozilla web docs](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
for details of how these work, as well as the section on [server requirements below](#the-server)

### Requirements and Limitations

#### OSD Compatibility

SziTileSource has been written to work with version 5.0.1 of OSD. No other versions are currently
supported.

#### The file

The file being read must be a valid SZI file, that is an uncompressed ZIP file containing a DZI file
pyramid, in a top level directory with the same name as the .dzi file, minus its extension (see the
[format description](https://github.com/smartinmedia/SZI-Format/blob/master/SZI%20format%20description%20-%202018-11-24.pdf)
for details).

However, there are few further restrictions, all of which are unlikely to cause trouble in practice,
but it's worth noting them in case your requirements are unusual. The SZI file must be:

* contained on a single disk - technically a single logical ZIP file can be split up and stored across
  multiple physical disks, but this is very unlikely to be done nowadays
* unencrypted
* less than 8096 TiB in size, as 2^53 is the largest integer value the JS Number type can safely
  handle

#### The server

The server where the file resides must:

* Support the `Range` header on GET requests 
* Return the `content-length` header when responding to HEAD requests
* Either have CORS correctly configured, or fulfill the same origin restrictions for the page where
the TileSource is being used

Most modern services and servers support the first two requirements, getting the third right is your
responsibility! Note that you *cannot* specify the `no-cors` mode in the `fetchOptions`, as
compliant browsers will not send Range headers to the server when that is set, resulting in the
whole SZI file being sent back to the browser.

## How it works

The basic idea is simple. By setting the Range header on GET requests to a given file, we can fetch
subsections of the SZI file. On creation of the SziTileSource, we use this technique to fetch the
file's Central Directory and process it to create a contents table containing the start and end
locations of the .dzi and the individual tiles. We then use the contents table to fetch the .dzi 
file to configure the OSD instance, and then, when OSD requests an individual image tile, use it to
fetch only the part of the SZI file that maps to that image tile. In practice, the actual
implementation turns out to be a little more complex.

### Fetching the Central Directory

A "normal" Zip file of less than 4GB in size looks something like this, with the arrows representing 
"knows the location of" :

```
     <Start of File>
     [Local Header 0] <-----------+
     [File Body 0]                |
     .                            | 
     .                            |  
     .                            |  
     [Local Header n] <-----------|---+
     [File Body n]                |   |
     [misc other data]            |   |
 +-->[Central Directory Header 0]-+   |
 |   .                                |
 |   .                                | 
 |   .                                |
 |   Central Directory Header n]------+
 +---[EOCD (variable length)]
     <End of File>
```

The Central Directory is always located at the end of the ZIP file. It's made up of a collection of
Central Directory Headers, each of which map to one of the zipped files, and terminated by a special
record, called the End Of Central Directory record (EOCD for short). This contains a field that
gives the location of the start of the Central Directory in the ZIP file. Unfortunately, the part of
the EOCD that follows this field is of variable length, as it can include a file-level of comment of
up to 2^16 - 1 bytes in length, so we can't just read a predefined number of bytes from the end of
the file to read the EOCD.

So for normal zip files we follow this process to find the location of the Central Directory:

1. Find the length of the entire file by making a HEAD request to the server, and grabbing the
   content-length from the response headers
2. Do a ranged GET request of the file from (content-length - maximum possible length of the EOCD)
   to content-length
3. Step backwards through the results of that request until we find the start of the EOCD (it begins
   with a magic number)
4. Read that EOCD in to discover the location of the Central Directory, its length in bytes, and the
   number of entries it contains.

For ZIP files bigger than 4GB it's even more complicated. These use an extended format know as
Zip64, and in this case there are two additional structures that need to be read: the Zip64 EOCD
Locator and the Zip64 EOCD. The standard EOCD still comes at the end of the file, but it's preceded
by the Zip64 EOCD Locator, and then that's preceded by the Zip64 EOCD, like so:

```
     <start of file>
     <Start of File>
     [Local Header 0] <-----------+
     [File Body 0]                |
     .                            | 
     .                            |  
     .                            |  
     [Local Header n] <-----------|---+
     [File Body n]                |   |
     [misc other data]            |   |
 +-->[Central Directory Header 0]-+   |
 |   .                                |
 |   .                                | 
 |   .                                |
 |   Central Directory Header n]------+
 +---[Zip64 EOCD (variable length)]<------+
     [Zip64 EOCD Locator (fixed length)]--+
     [EOCD (variable length)]
     <end of file>

```

The Zip64 structures will only be present if one of the fields that point to the location or size of
the Central Directory are set to their maximum values in the EOCD. 

All this means that the process of locating the Central Directory in a Zip64 file goes like this:

1. Find the length of the entire file by making a HEAD request to the server, and grabbing the
   content-length from the response headers
2. Do a ranged GET request of the file for the maximum possible length of the EOCD + the Zip64 EOCD
   Locator, ending at the content-length
3. Step backwards through the results of that request until we find the star of the EOCD  (it begins
   with a magic number)
4. Read the EOCD in. If the relevant fields are not set to their maximum, continue as per step 4 
   above, otherwise:
5. Skip backward from the start of the EOCD to the beginning of the Zip64 EOCD Locator in the
   original response, and read the location of the Zip64 EOCD from it
6. Do an additional ranged GET request from this location to the beginning of the Zip64 EOCD Locator
7. Read the Zip64 EOCD from the body of the response to that request to discover the location of the
   Central Directory, its length in bytes, and its number of entries

To read the CentralDirectory is comparatively easy: we just do a range GET from its start to finish
and then read in the entries sequentially. Note that these are again variable length, so to get the
location of the nth file in the ZIP, you have to read the preceding n-1 entries. 

Hopefully this demonstrates why finding the location of each tile from scratch every time we want to
load it is impractical!

### Fetching the .dzi file and the images

Once we've read the Central Directory we have know roughly where the individual file bodies live,
but not precisely: each chunk of file data starts with a Local Header containing various bits of
metadata, and it's the start location of this header that the Central Directory headers contain.
Unfortunately this is not necessarily the same data as that Central Directory Header: the values can
be different, and more importantly the *length* of the header can vary from that in the Central
Directory. So to reliably read in the body of the file, we need to perform the following steps:

1. Do a GET request with a Range from the start of the files header, to the start of the *next*
   file's header.
2. Read the header, and discard it
3. Read the body of the file

We then either parse the body as XML, in the case of the .dzi file, or pass it back to OSD in the
form of a Blob if it's an image tile.

### Everything else

Other than the fetching of the contents table and the .dzi as part of initialising the TileSource,
and the subsequent fetching of the image tiles, everything else in the implementation is inherited
from the DziFileSource, as the SZI in all other respects is identical to its unzipped sibling 
format.

## Development

### Getting started

To begin with, make sure you have 
[pnpm](https://pnpm.io/installation) and
[vite](https://vite.dev/guide/) installed.

Then, cd into this directory, and install the dependencies:

`pnpm install`

Once you've done this, you can just run the dev server:

`pnpm dev`

And you should then be able to see a lovely set of DZI and SZI zoomable images of Mix, my cat, if
you go to [http://localhost:5173](http://localhost:5173).

You can also run the test in `src/main.test.js` that tests the basic business of extracting the file
table of contents from an SZI tiled image of Mix. Either run

`pnpm test`

or by using your IDE. It's not much of test - it's mostly there so I can hand debug my code as I go. 
I will build out something better once I've got a pinch more abstraction and a more tractable test
data file.

### Building for distribution

To make both ES and UMD files for distribution, just run

`pnpm build`

and vite will create them in the `dist` folder.

## Acknowledgments

Need to appropriately acknowledge: GeoTIFF for inspiration, Tom for doing the explorer work, the
other chap whose work Tom built on!


