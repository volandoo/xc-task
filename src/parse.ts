import { Task, Waypoint } from "./types";

type XCTask = {
  turnpoints: {
    waypoint: {
      name: string;
      description: string;
      lat: number;
      lon: number;
      altSmoothed: number;
    };
    radius: number;
    type: string;
  }[];
  sss?: {
    type: string;
    direction: string;
    timeGates: string[];
  };
};

export var parseXctsk = function (text: string): Task {
  var task = JSON.parse(text) as XCTask;

  const waypoints = task.turnpoints.map((t, i) => {
    const goal = i === task.turnpoints.length - 1;
    const ess = i === task.turnpoints.length - 2;
    const point: Waypoint = {
      radius: t.radius,
      type:
        t.type === "TAKEOFF" || i === 0
          ? "takeoff"
          : i === 1
          ? "start"
          : t.type === "ESS" || ess
          ? "ess"
          : t.type === "GOAL" || goal
          ? "goal"
          : "turn",
      latLng: { lat: t.waypoint.lat, lon: t.waypoint.lon },
    };
    return point;
  });

  let startTime = 0;
  const time = task.sss?.timeGates[0].replace("Z", "");
  if (time) {
    const parts = time.split(":");
    startTime = new Date()
      .setUTCHours(
        parseInt(parts[0]),
        parseInt(parts[1]),
        parseInt(parts[2]),
        0
      )
      .valueOf();
  }
  return {
    waypoints,
    startTime,
  };
};

enum WayPointTypes {
  TAKEOFF = "takeoff",
  SSS_ENTER = "start",
  SSS_EXIT = "turn",
  ESS_ENTER = "ess",
  GOL_CILINDRO = "goal",
  GOL_LINEA = "goal",
  TUP_ENTER = "turn",
}

type QRSimple = {
  T: "W";
  V: 2;
  t: { n: string; z: string }[];
};
type QRComplete = {
  taskType: "CLASSIC";
  version: 2;
  t: { n: string; d: string; z: string; t?: number }[];
};
const parseXctskQRSimple = (data: QRSimple): Waypoint[] => {
  const factor = Math.pow(10, 5);
  const result: Waypoint[] = [];
  for (let i = 0; i < data.t.length; i++) {
    const arr = decode(data.t[i].z);
    result.push({
      latLng: {
        lon: arr[0] / factor,
        lat: arr[1] / factor,
      },
      radius: 0,
    });
  }

  return result;
};

const parseXctskQRComplete = (data: QRComplete): Waypoint[] => {
  const factor = Math.pow(10, 5);
  const result: Waypoint[] = [];
  for (let i = 0; i < data.t.length; i++) {
    const { z, t } = data.t[i];
    const arr = decode(z);
    result.push({
      latLng: {
        lon: arr[0] / factor,
        lat: arr[1] / factor,
      },
      radius: arr[3],
      type:
        t == 2
          ? "start"
          : t == 3
          ? "ess"
          : i === data.t.length - 1
          ? "goal"
          : "turn",
    });
  }

  return result;
};

export var parseXctskQR = function (text: string): Waypoint[] {
  const resp: Waypoint[] = [];

  if (text.indexOf("XCTSK:") > -1) {
    const task = JSON.parse(text.replace("XCTSK:", "")) as QRComplete;
    return parseXctskQRComplete(task);
  } else {
    const task = JSON.parse(text) as QRSimple;
    return parseXctskQRSimple(task);
  }
  /*
  if (task[])
  const goal: { t: string } = task["g"] || { t: "" };
  const startPoint: { g: string; d: string } = task["s"] || {
    g: "",
    d: "",
  };
  const wayPoints: { n: string; d: string; z: string }[] = task["t"] || [];

  if (wayPoints.length > 2) {
    let wTempTipo: string, wTipo: string;
    let wLat: number, wLon: number, wRadio: number;
    let first = true;

    for (let i = 0; i < wayPoints.length; i++) {
      // wTime = "null";

      wTempTipo = wayPoints[i]["t"] || "";

      if (first) {
        wTipo = WayPointTypes.TAKEOFF;
        first = false;
      } else if (wTempTipo == "2") {
        // wTime = startPoint["g"].replace('["', "").replace('Z"]', "");
        // wTime = TimeHelper.stringWithOffset(wTime.substring(0, 5));
        wTipo =
          startPoint["d"] == "1"
            ? WayPointTypes.SSS_ENTER
            : WayPointTypes.SSS_EXIT;
      } else if (wTempTipo == "3") {
        wTipo = WayPointTypes.ESS_ENTER;
      } else if (i == wayPoints.length - 1) {
        wTipo =
          goal == null || goal["t"] == "2"
            ? WayPointTypes.GOL_CILINDRO
            : WayPointTypes.GOL_LINEA;

        // try
        // wTime = goal != null? TimeHelper.stringWithOffset(goal.getString("d").substring(0, 5)) :
        // TimeHelper.stringWithOffset("23:00:00");
        // }
        // catch (JSONException e)
        // {
        //     wTime = TimeHelper.stringWithOffset("23:00:00");

        //     Message.ee(TAG, "JSON Exception D", e, true);
        // }
      } else {
        wTipo = WayPointTypes.TUP_ENTER;
      }

      const waypoint = wayPoints[i];

      // wName = waypoint["n"] == null ? "" : waypoint["n"].trim();
      // wDesc = waypoint["d"] == null ? "" : waypoint["d"].trim();
      const integers = decodePoly(waypoint["z"]);
      wLon = integers[0] / 0x1e5f;
      wLat = integers[1] / 0x1e5f;
      // wAlt = integers[2];
      wRadio = integers[3];

      resp.push({
        latLng: {
          lat: wLat,
          lon: wLon,
        },
        radius: wRadio,
        // @ts-ignore
        type: wTipo,
      });
      // mArrayWayPoint.push(new WayPoint(wName, wDesc, new GeoPoint(wLon, wLat, wAlt), i, wTipo, wRadio, wTime));
    }
  }
  return resp;
  // catch (OutOfMemoryError e)
  // {
  //     NotificacionesToast.showToast(NotificacionesToast.paqueteNoValido,
  //                                   NotificacionesToast.ToasType.ERROR);
  //     dateName[0] = null;
  //     Message.ee(TAG, "Out Of Memory Error", e, true);
  // }
  // catch (JSONException e)
  // {
  //     NotificacionesToast.showToast(NotificacionesToast.paqueteNoValido,
  //                                   NotificacionesToast.ToasType.ERROR);
  //     dateName[0] = null;
  //     Message.ee(TAG, "JSON Exception ALL", e, true);
  // }
*/
};

export const decode = function (encodedPath: string, precision = 5) {
  const response: number[] = [];

  let index = 0;
  for (let i = 0; i < 4; i++) {
    // Fully unrolling the following loops speeds things up about 5%.
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = encodedPath.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    response.push(result & 1 ? ~(result >> 1) : result >> 1);
  }

  return response;
};
