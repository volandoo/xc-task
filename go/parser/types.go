package parser

type XCTaskWaypoint struct {
	Waypoint struct {
		Name        string  `json:"name"`
		Description string  `json:"description"`
		Lat         float64 `json:"lat"`
		Lon         float64 `json:"lon"`
		AltSmoothed float64 `json:"altSmoothed"`
	} `json:"waypoint"`
	Radius float64 `json:"radius"`
	Type   string  `json:"type"`
}

type XCTaskSSS struct {
	Type      string   `json:"type"`
	Direction string   `json:"direction"`
	TimeGates []string `json:"timeGates"`
}

type XCTaskGoal struct {
	Type string `json:"type"`
}

type XCTask struct {
	Turnpoints []XCTaskWaypoint `json:"turnpoints"`
	Sss        *XCTaskSSS       `json:"sss"`
	Goal       *XCTaskGoal      `json:"goal"`
}
