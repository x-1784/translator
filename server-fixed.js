const { startServer } = require("./app-server");

startServer(Number(process.env.PORT || 3000))
  .then(({ url }) => {
    console.log(`Translator app running at ${url}`);
  })
  .catch((error) => {
    console.error("Failed to start translator app:", error);
    process.exit(1);
  });
