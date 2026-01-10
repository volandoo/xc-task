package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	pretty "github.com/jedib0t/go-pretty/v6/table"
	compscore "github.com/volandoo/go-xctask/comp-score"
	"github.com/volandoo/go-xctask/parser"
)

func main() {
	// Define command line flags
	taskFile := flag.String("task", "", "Path to the task file (.xctsk)")
	tracksFile := flag.String("tracks", "", "Path to the tracks directory")

	// Parse command line arguments
	flag.Parse()

	// Validate required arguments
	if *taskFile == "" {
		fmt.Fprintf(os.Stderr, "Error: --task argument is required\n")
		flag.Usage()
		os.Exit(1)
	}

	if *tracksFile == "" {
		fmt.Fprintf(os.Stderr, "Error: --tracks argument is required\n")
		flag.Usage()
		os.Exit(1)
	}

	tracks, err := os.ReadDir(*tracksFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	taskStr, err := os.ReadFile(*taskFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	task, err := parser.ParseXctsk(string(taskStr))
	if err != nil {
		fmt.Fprintf(os.Stderr, "2 Error: %v\n", err)
		os.Exit(1)
	}

	results := []compscore.ScoreResult{}
	errors := make(chan error, len(tracks))

	wg := sync.WaitGroup{}
	mutex := sync.RWMutex{}
	for _, track := range tracks {
		if !strings.HasSuffix(track.Name(), ".igc") {
			continue
		}
		wg.Add(1)
		go func(filename string) {
			defer wg.Done()
			trackStr, err := os.ReadFile(filepath.Join(*tracksFile, filename))
			if err != nil {
				errors <- fmt.Errorf("error reading file %s: %v", filename, err)
				return
			}
			pilot, track, err := parser.ParseIgc(strings.Split(string(trackStr), "\n"))
			if err != nil {
				errors <- fmt.Errorf("error parsing IGC file %s: %v", filename, err)
				return
			}

			flightStats, err := compscore.GetTracksStats(track, task)
			if err != nil {
				errors <- fmt.Errorf("error calculating stats for %s: %v", filename, err)
				return
			}
			flightStats.Pilot = pilot
			mutex.Lock()
			results = append(results, flightStats)
			mutex.Unlock()
		}(track.Name())
	}

	wg.Wait()
	close(errors)

	// Check for errors
	hasErrors := false
	for err := range errors {
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			hasErrors = true
		}
	}

	if hasErrors {
		fmt.Fprintf(os.Stderr, "Some files had errors, but continuing with successful results...\n")
	}

	slices.SortFunc(results, func(b, a compscore.ScoreResult) int {
		return strings.Compare(a.Pilot.Name, b.Pilot.Name)
	})
	distances := make([]compscore.Pilot, 0, len(results))
	for _, result := range results {

		dtsts := make([]compscore.TrackPoint, 0, len(result.Distances))
		for _, distance := range result.Distances {
			dtsts = append(dtsts, compscore.TrackPoint{
				Time: float64(distance.Time),
				DTG:  float64(distance.ToGoal),
			})
		}
		distances = append(distances, compscore.Pilot{
			ID:        result.Pilot.Name,
			Track:     dtsts,
			StartGate: float64(result.SSSTime),
		})
	}
	jsondistances, err := json.MarshalIndent(distances, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	os.WriteFile("distances.json", jsondistances, 0644)
	now := time.Now().UTC()
	endTime := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 0, time.UTC)
	leadingPoints := compscore.ComputeLeadingPerGate(distances, 110.0, false, 2.0/3.0, float64(endTime.Unix()))

	tw := pretty.NewWriter()
	tw.AppendHeader(pretty.Row{"Pilot", "Wing", "SS", "ES", "Time", "Speed", "Distance", "Leading Points"})
	for i := 0; i < len(results); i++ {
		result := results[i]
		tostring := result.ToString()
		tw.AppendRow(pretty.Row{tostring.Pilot,
			tostring.Wing,
			tostring.SS,
			tostring.ES,
			tostring.Time,
			tostring.Speed,
			tostring.Distance,
			fmt.Sprintf("%0.2f", leadingPoints[result.Pilot.Name]),
		})
	}
	fmt.Println(tw.Render())

}
