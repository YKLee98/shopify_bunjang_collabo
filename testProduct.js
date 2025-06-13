// testProduct.js
const orderService = require('./src/services/orderService');

async function test() {
  const result = await orderService.testBunjangProductOrder('332047857');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

test();