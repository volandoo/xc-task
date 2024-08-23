import { parseXctskQR } from "./parse";

const fs = require("fs");
const { processTask, parseXctsk } = require("../dist/main");

const main = () => {
  let xctsk = fs.readFileSync("./test/fixtures/qr.code");
  const parsed = parseXctskQR(xctsk.toString());
  console.log(parsed);
  // let parsed = parseXctsk(xctsk.toString());
  // let processed = processTask(parsed.waypoints);
  // console.log("task1.xctsk", parsed.startTime, processed);
  // xctsk = fs.readFileSync("./test/fixtures/task2.xctsk");
  // parsed = parseXctsk(xctsk.toString());
  // processed = processTask(parsed.waypoints);
  // console.log("task2.xctsk", parsed.startTime, processed);
  // xctsk = fs.readFileSync("./test/fixtures/task3.xctsk");
  // parsed = parseXctsk(xctsk.toString());
  // processed = processTask(parsed.waypoints);
  // console.log("task3.xctsk", parsed.startTime, processed);
  // xctsk = fs.readFileSync("./test/fixtures/task4.xctsk");
  // parsed = parseXctsk(xctsk.toString());
  // processed = processTask(parsed.waypoints);
  // console.log("task4.xctsk", parsed.startTime, processed);
  // xctsk = fs.readFileSync("./test/fixtures/task5.xctsk");
  // parsed = parseXctsk(xctsk.toString());
  // processed = processTask(parsed.waypoints);
  // console.log("task5.xctsk", parsed.startTime, processed);
  // xctsk = fs.readFileSync("./test/fixtures/task6.xctsk");
  // parsed = parseXctsk(xctsk.toString());
  // processed = processTask(parsed.waypoints);
  // console.log("task6.xctsk", parsed.startTime, processed);
};

main();
