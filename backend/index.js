const { createGongzhuServer } = require('./src/server/createServer');

const { server } = createGongzhuServer();
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
