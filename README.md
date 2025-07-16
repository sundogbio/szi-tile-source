# szi-tile-source #
OpenSeaDragon TileSource for SZI files 

## Getting things running ##

Very much a WIP right now, but if you install the dependencies

`npm install`

And get the local vite server running

`npx vite`

You can see a lovely *dzi* tiled image of Mix if you go to [http://localhost:5137](http://localhost:5137).

You can also run the test in `src/main.test.js` that tests the basic business of extracting the file table of
contents from an *szi* tiled image of Mix. Either run

`npx vitest`

or by using your IDE. It's not much of test - it's mostly there so I can hand debug my code as I go. I will build out
something better once I've got a pinch more abstraction and a more tractable test data file.
