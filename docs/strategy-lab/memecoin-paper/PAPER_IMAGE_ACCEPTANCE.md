# Paper image acceptance

Run `node --test test/memecoin-paper-image.test.js` to build `Dockerfile.paper`, import and assemble the pinned producer inside the image with container networking disabled, and verify that the no-argument entrypoint returns `DISABLED`. The test checks the image's `node` ownership and existing entrypoint. It never starts acquisition or contacts a provider.

If Docker is unavailable, the test stages the Dockerfile's `COPY` sources and runs the same assembly and disabled checks locally; its diagnostic explicitly says that image execution was not verified.
