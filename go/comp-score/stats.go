package compscore

import (
	"fmt"
	"math"

	"github.com/volandoo/go-xctask/solver"
	"github.com/volandoo/go-xctask/traveler"
	"github.com/volandoo/go-xctask/types"
)

func toGoal(point types.TrackPoint, task types.Task, step traveler.CurrentStep) (float64, error) {
	waypoints := []types.Waypoint{
		{
			LatLng: point.LatLng,
			Radius: 1,
		},
	}
	for i := step.VisitedCount; i < len(task.Waypoints); i++ {
		waypoints = append(waypoints, task.Waypoints[i])
	}
	solverResult, err := solver.SolveTask(waypoints, task.GoalType, true)
	if err != nil {
		return 0, err
	}
	return float64(solverResult.Distance), nil
}

func GetTracksStats(track []types.TrackPoint, task types.Task) (ScoreResult, error) {

	result := ScoreResult{}
	taskResult, err := solver.SolveTask(task.Waypoints, task.GoalType, true)
	if err != nil {
		return result, err
	}

	togoal := []GetTracksStatsResult{}
	sssIndex := traveler.GetSSSIndex(task)
	essIndex := traveler.GetESSIndex(task)

	lastStep := traveler.TravelTask(task, track, nil, func(step traveler.CurrentStep) {
		point := track[step.TrackIndex]
		prev := math.MaxFloat64
		if step.TrackIndex < sssIndex {
			return
		}
		if len(togoal) > 0 {
			prev = float64(togoal[len(togoal)-1].ToGoal)
		}
		to, err := toGoal(point, task, step)
		if err != nil {
			// Log error but continue processing
			fmt.Printf("Warning: error calculating distance to goal: %v\n", err)
			return
		}
		to = math.Min(to, prev)
		if prev != to {
			dist := taskResult.Distance - int64(to)
			if dist > 0 {
				togoal = append(togoal, GetTracksStatsResult{
					Time:     point.Time,
					ToGoal:   int64(to),
					Distance: taskResult.Distance - int64(to),
				})
			}
		}
	}, 30)
	if lastStep.VisitedCount == len(task.Waypoints) {
		// we are in goal, replace last one
		lastIndex := len(togoal) - 1
		togoal[lastIndex].Distance = taskResult.Distance
		togoal[lastIndex].ToGoal = 0
		result.ESSTime = lastStep.Waypoints[essIndex].Time
	} else {
		result.ESSTime = -1
	}

	startTime := task.StartTimes[0]
	if len(task.StartTimes) > 1 && len(lastStep.Waypoints) > sssIndex {
		for _, time := range task.StartTimes {
			if lastStep.Waypoints[sssIndex].Time > time {
				startTime = time
			}
		}
		result.SSSTime = startTime
	} else {
		result.SSSTime = -1
	}

	if result.ESSTime > -1 && result.SSSTime > -1 {
		result.ElapsedTime = result.ESSTime - result.SSSTime
	} else if result.SSSTime > -1 {
		result.ElapsedTime = track[len(track)-1].Time - result.SSSTime
	} else {
		result.ElapsedTime = 0
	}

	result.Distances = togoal

	// Calculate speed only if we have distance data and elapsed time
	if len(togoal) > 0 && result.ElapsedTime > 0 {
		result.Speed = float64(togoal[len(togoal)-1].Distance/1000) / float64(result.ElapsedTime) * 3600
	} else {
		result.Speed = 0
	}

	return result, nil
}
