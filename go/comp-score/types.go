package compscore

import (
	"fmt"
	"time"

	"github.com/volandoo/go-xctask/types"
)

type GetTracksStatsResult struct {
	Time     int64 `json:"time"`
	ToGoal   int64 `json:"toGoal"`
	Distance int64 `json:"distance"`
}

type ScoreResultString struct {
	Pilot    string `json:"pilot"`
	Wing     string `json:"wing"`
	Time     string `json:"time"`
	ES       string `json:"es"`
	SS       string `json:"ss"`
	Speed    string `json:"speed"`
	Distance string `json:"distance"`
}

type ScoreResult struct {
	Pilot       types.PilotInfo        `json:"pilot"`
	Distances   []GetTracksStatsResult `json:"distances"`
	ElapsedTime int64                  `json:"elapsedTime"`
	ESSTime     int64                  `json:"essTime"`
	SSSTime     int64                  `json:"sssTime"`
	Speed       float64                `json:"speed"`
}

func formatTime(seconds int64) string {
	if seconds == -1 {
		return "-"
	}
	t := time.Unix(seconds, 0)
	return t.Format("15:04:05")
}

func formatSpeed(speed float64) string {
	if speed == 0 {
		return "-"
	}
	return fmt.Sprintf("%0.2f km/h", speed)
}

func formatDistance(distance int64) string {
	if distance == 0 {
		return "-"
	}
	return fmt.Sprintf("%0.2f km", float64(distance)/1000)
}

func (s *ScoreResult) ToString() ScoreResultString {
	var distance int64
	if len(s.Distances) > 0 {
		distance = s.Distances[len(s.Distances)-1].Distance
	}

	return ScoreResultString{
		Pilot:    s.Pilot.Name,
		Wing:     s.Pilot.Wing,
		SS:       formatTime(s.SSSTime),
		ES:       formatTime(s.ESSTime),
		Time:     formatTime(s.ElapsedTime),
		Speed:    formatSpeed(s.Speed),
		Distance: formatDistance(distance),
	}
}
