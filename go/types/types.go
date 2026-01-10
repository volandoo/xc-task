package types

type LatLng struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type Waypoint struct {
	LatLng    LatLng  `json:"latLng"`
	Radius    float64 `json:"radius"`
	Type      string  `json:"type,omitempty"`
	Direction string  `json:"direction,omitempty"` // "enter" or "exit"
}

type Task struct {
	Waypoints  []Waypoint `json:"waypoints"`
	StartTimes []int64    `json:"startTimes"` // timestamp utc
	GoalType   string     `json:"goalType"`
}

type PilotInfo struct {
	Name string `json:"name"`
	Wing string `json:"wing"`
}

// TrackPoint represents a point in the pilot's track.
type TrackPoint struct {
	LatLng LatLng `json:"latLng"`
	Time   int64  `json:"time"`
}

func (t *TrackPoint) Copy() TrackPoint {
	return TrackPoint{
		LatLng: t.LatLng,
		Time:   t.Time,
	}
}
