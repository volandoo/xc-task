const fs = require("fs");
const { processTask, parseXctsk } = require("../dist/main");

const main = () => {
  let xctsk = fs.readFileSync("./test/fixtures/task1.xctsk");
  let processed = processTask(parseXctsk(xctsk.toString()).waypoints);
  console.log({ distance: processed.distance, distances: processed.distances });
  xctsk = fs.readFileSync("./test/fixtures/task2.xctsk");
  processed = processTask(parseXctsk(xctsk.toString()).waypoints);
  console.log({ distance: processed.distance, distances: processed.distances });
  xctsk = fs.readFileSync("./test/fixtures/task3.xctsk");
  processed = processTask(parseXctsk(xctsk.toString()).waypoints);
  console.log({ distance: processed.distance, distances: processed.distances });
  xctsk = fs.readFileSync("./test/fixtures/task4.xctsk");
  processed = processTask(parseXctsk(xctsk.toString()).waypoints);
  console.log({ distance: processed.distance, distances: processed.distances });
  xctsk = fs.readFileSync("./test/fixtures/task5.xctsk");
  processed = processTask(parseXctsk(xctsk.toString()).waypoints);
  console.log({ distance: processed.distance, distances: processed.distances });
  xctsk = fs.readFileSync("./test/fixtures/task6.xctsk");
  processed = processTask(parseXctsk(xctsk.toString()).waypoints);
  console.log({ distance: processed.distance, distances: processed.distances });
};

main();
