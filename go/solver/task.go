package solver

import (
	"fmt"
	"math"

	geojson "github.com/paulmach/go.geojson"
	"github.com/pymaxion/geographiclib-go/geodesic"
	proj "github.com/twpayne/go-proj/v11"
	"github.com/volandoo/go-xctask/types"
)

type Result struct {
	GeoJSON   *geojson.FeatureCollection `json:"geojson"`
	Distance  int64                      `json:"distance"`
	Distances []int64                    `json:"distances"`
	Waypoints []types.Waypoint           `json:"waypoints"`
}

type ShortPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Point struct {
	ShortPoint
	Radius float64 `json:"radius"`
	Fx     float64 `json:"fx"`
	Fy     float64 `json:"fy"`
}

func SolveTask(turnpoints []types.Waypoint, goalType string, makeGeojson bool) (Result, error) {
	var waypoints []types.Waypoint

	zone := 33 // just default if not valid turnpoits yet
	if len(turnpoints) > 0 {
		zone = getUtmZoneFromPosition(turnpoints[0].LatLng.Lon, turnpoints[0].LatLng.Lat)
	}

	es := len(turnpoints) - 2
	for i, tp := range turnpoints {
		if tp.Type == "ess" {
			es = i
		}
	}

	points := make([]Point, len(turnpoints))
	for i, tp := range turnpoints {
		p, err := degrees2utm(tp.LatLng.Lon, tp.LatLng.Lat, zone)

		if err != nil {
			return Result{}, err
		}
		points[i] = createPoint(p[0], p[1], tp.Radius)
	}

	distance, directions, goalline := getShortestPath(points, es, goalType == "line", zone)
	for i := range points {
		fl, err := utm2degress(points[i].Fx, points[i].Fy, zone)
		if err != nil {
			return Result{}, err
		}
		if i == 1 {
			// if first waypoint is ess, then direction should be "exit"
			if computeDistanceBetweentLatLng(
				turnpoints[0].LatLng,
				turnpoints[1].LatLng,
			) < turnpoints[1].Radius {
				directions[1] = "exit"
			}
		}
		waypoints = append(waypoints, types.Waypoint{
			LatLng: types.LatLng{
				Lat: fl[1], Lon: fl[0],
			},
			Radius:    points[i].Radius,
			Direction: directions[i],
		})
	}
	distances := recalcDistance(waypoints)

	var featureCollection *geojson.FeatureCollection
	if makeGeojson {
		featureCollection = geojson.NewFeatureCollection()
		line := createLine(waypoints)
		featureCollection.AddFeature(line)
		cylinders := createCylinders(turnpoints, goalline)
		for _, cylinder := range cylinders {
			featureCollection.AddFeature(cylinder)
		}
	}

	return Result{
		GeoJSON:   featureCollection,
		Distance:  int64(distance),
		Distances: distances,
		Waypoints: waypoints,
	}, nil
}

const INT_MAX = math.MaxInt64

var geod = geodesic.WGS84

var utms = make(map[int]*proj.PJ)

func getProj(zone int) (*proj.PJ, error) {
	if utms[zone] == nil {
		pj, err := proj.NewCRSToCRS(getProjStr(zone), "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs", nil)
		if err != nil {
			return nil, err
		}
		utms[zone] = pj
	}
	return utms[zone], nil
}

func recalcDistance(waypoints []types.Waypoint) []int64 {
	var distances []int64
	if len(waypoints) > 1 {
		for i := 0; i < len(waypoints)-1; i++ {
			distance := computeDistanceBetweentLatLng(waypoints[i].LatLng, waypoints[i+1].LatLng)
			distances = append(distances, int64(math.Round(distance)))
		}
	}
	return distances
}

func createPoint(x, y, radius float64) Point {
	return Point{ShortPoint: ShortPoint{X: x, Y: y}, Radius: radius, Fx: x, Fy: y}
}

func createPointFromCenter(point Point) Point {
	return createPoint(point.X, point.Y, point.Radius)
}

func createPointFromFix(point Point) Point {
	return createPoint(point.Fx, point.Fy, point.Radius)
}

func getShortestPath(points []Point, esIndex int, goalLine bool, zone int) (float64, []string, []types.LatLng) {
	const tolerance = 1.0
	lastDistance := float64(INT_MAX)
	finished := false
	count := len(points)
	opsCount := count * 10
	var goalline []types.LatLng
	var directions []string
	var distance float64
	for !finished && opsCount > 0 {
		opsCount--
		distance, directions, goalline = optimizePath(points, esIndex, goalLine, zone)
		finished = lastDistance-distance < tolerance
		lastDistance = distance
	}
	return lastDistance, directions, goalline
}

func optimizePath(points []Point, esIndex int, goalLine bool, zone int) (float64, []string, []types.LatLng) {
	distance := 0.0
	directions := []string{"exit"}

	var goalline []types.LatLng
	var count = len(points)
	for index := 1; index < count; index++ {
		c, a, b := getTargetPoints(points, count, index, esIndex)
		if index == count-1 && goalLine {
			goalline = processLine(c, a, zone)
			directions = append(directions, "enter")
		} else {
			direction := processCylinder(c, a, b)
			directions = append(directions, direction)
		}
		legDistance := math.Hypot(a.X-c.Fx, a.Y-c.Fy)
		distance += legDistance
	}
	return distance, directions, goalline
}

func getTargetPoints(points []Point, count int, index int, esIndex int) (*Point, Point, Point) {
	c := &points[index]
	a := createPointFromFix(points[index-1])
	var b Point
	if index == count-1 || index == esIndex {
		b = createPointFromCenter(*c)
	} else {
		b = createPointFromFix(points[index+1])
	}
	return c, a, b
}

func processCylinder(c *Point, a Point, b Point) string {
	distAC, distBC, distAB, distCtoAB := getRelativeDistances(c, a, b)
	var direction = "enter"
	if distAB == 0.0 {
		projectOnCircle(c, a.X, a.Y, distAC)
	} else if pointOnCircle(c, a, b, distAC, distBC, distAB, distCtoAB) {
		return direction
	} else if distCtoAB < c.Radius {
		if distAC < c.Radius && distBC < c.Radius {
			setReflection(c, a, b)
			direction = "exit"
		} else if (distAC < c.Radius && distBC > c.Radius) || (distAC > c.Radius && distBC < c.Radius) {
			setIntersection1(c, a, b, distAB)
		} else if distAC > c.Radius && distBC > c.Radius {
			setIntersection2(c, a, b, distAB)
		}
	} else {
		setReflection(c, a, b)
	}
	return direction
}

func getRelativeDistances(c *Point, a, b Point) (float64, float64, float64, float64) {
	distAC := math.Hypot(a.X-c.X, a.Y-c.Y)
	distBC := math.Hypot(b.X-c.X, b.Y-c.Y)
	len2 := math.Pow(a.X-b.X, 2) + math.Pow(a.Y-b.Y, 2)
	distAB := math.Sqrt(len2)

	var distCtoAB float64
	if len2 == 0.0 {
		distCtoAB = distAC
	} else {
		t := ((c.X-a.X)*(b.X-a.X) + (c.Y-a.Y)*(b.Y-a.Y)) / len2
		if t < 0.0 {
			distCtoAB = distAC
		} else if t > 1.0 {
			distCtoAB = distBC
		} else {
			cpx := t*(b.X-a.X) + a.X
			cpy := t*(b.Y-a.Y) + a.Y
			distCtoAB = math.Hypot(cpx-c.X, cpy-c.Y)
		}
	}
	return distAC, distBC, distAB, distCtoAB
}

func getIntersectionPoints(c *Point, a, b Point, distAB float64) (Point, Point, Point) {
	dx := (b.X - a.X) / distAB
	dy := (b.Y - a.Y) / distAB
	t2 := dx*(c.X-a.X) + dy*(c.Y-a.Y)
	ex := t2*dx + a.X
	ey := t2*dy + a.Y
	dt2 := math.Pow(c.Radius, 2) - math.Pow(ex-c.X, 2) - math.Pow(ey-c.Y, 2)
	var dt float64
	if dt2 > 0 {
		dt = math.Sqrt(dt2)
	}
	s1x := (t2-dt)*dx + a.X
	s1y := (t2-dt)*dy + a.Y
	s2x := (t2+dt)*dx + a.X
	s2y := (t2+dt)*dy + a.Y
	return createPoint(s1x, s1y, 0), createPoint(s2x, s2y, 0), createPoint(ex, ey, 0)
}

func pointOnCircle(c *Point, a, b Point, distAC, distBC, distAB, distCtoAB float64) bool {
	if math.Abs(distAC-c.Radius) < 0.0001 {
		c.Fx = a.X
		c.Fy = a.Y
		return true
	}
	if math.Abs(distBC-c.Radius) < 0.0001 {
		if distCtoAB < c.Radius && distAC > c.Radius {
			setIntersection2(c, a, b, distAB)
		} else {
			c.Fx = b.X
			c.Fy = b.Y
		}
		return true
	}
	return false
}

func projectOnCircle(c *Point, x, y, len float64) {
	if len == 0.0 {
		c.Fx = c.Radius + c.X
		c.Fy = c.Y
	} else {
		c.Fx = (c.Radius*(x-c.X))/len + c.X
		c.Fy = (c.Radius*(y-c.Y))/len + c.Y
	}
}

func setIntersection1(c *Point, a, b Point, distAB float64) {
	s1, s2, _ := getIntersectionPoints(c, a, b, distAB)
	as1 := math.Hypot(a.X-s1.X, a.Y-s1.Y)
	bs1 := math.Hypot(b.X-s1.X, b.Y-s1.Y)
	if math.Abs(as1+bs1-distAB) < 0.0001 {
		c.Fx = s1.X
		c.Fy = s1.Y
	} else {
		c.Fx = s2.X
		c.Fy = s2.Y
	}
}

func setIntersection2(c *Point, a, b Point, distAB float64) {
	s1, s2, e := getIntersectionPoints(c, a, b, distAB)
	as1 := math.Hypot(a.X-s1.X, a.Y-s1.Y)
	es1 := math.Hypot(e.X-s1.X, e.Y-s1.Y)
	ae := math.Hypot(a.X-e.X, a.Y-e.Y)
	if math.Abs(as1+es1-ae) < 0.0001 {
		c.Fx = s1.X
		c.Fy = s1.Y
	} else {
		c.Fx = s2.X
		c.Fy = s2.Y
	}
}

func setReflection(c *Point, a, b Point) {
	af := math.Hypot(a.X-c.Fx, a.Y-c.Fy)
	bf := math.Hypot(b.X-c.Fx, b.Y-c.Fy)
	t := af / (af + bf)
	kx := t*(b.X-a.X) + a.X
	ky := t*(b.Y-a.Y) + a.Y
	kc := math.Hypot(kx-c.X, ky-c.Y)
	projectOnCircle(c, kx, ky, kc)
}

func processLine(c *Point, a Point, zone int) []types.LatLng {
	prevCoords, _ := utm2degress(c.X, c.Y, zone)
	goalCoords, _ := utm2degress(a.X, a.Y, zone)

	goal := types.LatLng{Lat: goalCoords[1], Lon: goalCoords[0]}
	prev := types.LatLng{Lat: prevCoords[1], Lon: prevCoords[0]}

	lastLegHeading := computeHeading(goal, prev)
	if lastLegHeading < 0 {
		lastLegHeading += 360
	}
	heading := lastLegHeading + 90

	firstPoint := computeOffset(prev, c.Radius, heading)

	heading += 180
	secondPoint := computeOffset(firstPoint, 2*c.Radius, heading)

	p1, _ := degrees2utm(firstPoint.Lon, firstPoint.Lat, zone)
	p2, _ := degrees2utm(secondPoint.Lon, secondPoint.Lat, zone)

	goalLine := []ShortPoint{{X: p1[0], Y: p1[1]}, {X: p2[0], Y: p2[1]}}

	g1 := goalLine[0]
	g2 := goalLine[1]
	len2 := math.Pow(g1.X-g2.X, 2) + math.Pow(g1.Y-g2.Y, 2)
	if len2 == 0.0 {
		c.Fx = g1.X
		c.Fy = g1.Y
	} else {
		t := ((a.X-g1.X)*(g2.X-g1.X) + (a.Y-g1.Y)*(g2.Y-g1.Y)) / len2
		if t < 0.0 {
			c.Fx = g1.X
			c.Fy = g1.Y
		} else if t > 1.0 {
			c.Fx = g2.X
			c.Fy = g2.Y
		} else {
			c.Fx = t*(g2.X-g1.X) + g1.X
			c.Fy = t*(g2.Y-g1.Y) + g1.Y
		}
	}
	return []types.LatLng{firstPoint, secondPoint}
}

func getUtmZoneFromPosition(lon, lat float64) int {
	val := (lon + 180) / 6

	floorVal := math.Floor(val)
	modVal := int(floorVal) % 60
	zone := modVal + 1
	return zone
}

func degrees2utm(lon, lat float64, zone int) ([]float64, error) {
	pj, err := getProj(zone)
	if err != nil {
		return nil, err
	}
	coord := proj.NewCoord(lon, lat, 0, 0) // Corrected: lon, lat for geographic coordinates
	trans, err := pj.Inverse(coord)
	if err != nil {
		return nil, err
	}
	return []float64{trans.X(), trans.Y()}, nil // Returns [lon, lat]
}

func utm2degress(x, y float64, zone int) ([]float64, error) {
	pj, err := getProj(zone)
	if err != nil {
		return nil, err
	}
	coord := proj.NewCoord(x, y, 0, 0) // x, y for UTM coordinates
	trans, err := pj.Forward(coord)
	if err != nil {
		return nil, err
	}
	return []float64{trans.X(), trans.Y()}, nil // Returns [lon, lat]
}

func getProjStr(zone int) string {
	return fmt.Sprintf("+proj=utm +zone=%d +ellps=WGS84 +datum=WGS84 +no_defs", zone)
}

func computeHeading(latLng1, latLng2 types.LatLng) float64 {
	r := geod.Inverse(latLng1.Lat, latLng1.Lon, latLng2.Lat, latLng2.Lon)
	return r.Azi1
}

func computeOffset(latLng types.LatLng, radius, heading float64) types.LatLng {
	r := geod.Direct(latLng.Lat, latLng.Lon, heading, radius)
	return types.LatLng{Lat: r.Lat2, Lon: r.Lon2}
}

func computeDistanceBetweentLatLng(wpt1, wpt2 types.LatLng) float64 {
	r := geod.Inverse(wpt1.Lat, wpt1.Lon, wpt2.Lat, wpt2.Lon)
	return r.S12
}

func createCircle(lon, lat, radius float64) *geojson.Feature {
	steps := 100
	coordinates := make([][]float64, steps+1)
	for i := 0; i <= steps; i++ {
		angle := float64(i) / float64(steps) * 2 * math.Pi
		dx := radius * math.Cos(angle)
		dy := radius * math.Sin(angle)
		point := computeOffset(types.LatLng{Lat: lat, Lon: lon}, dx, 90)
		point = computeOffset(point, dy, 0)
		coordinates[i] = []float64{point.Lon, point.Lat}
	}
	return geojson.NewPolygonFeature([][][]float64{coordinates})
}

func createCylinders(waypoints []types.Waypoint, goalLine []types.LatLng) []*geojson.Feature {
	features := make([]*geojson.Feature, len(waypoints))
	for i, waypoint := range waypoints {
		if len(goalLine) > 0 && i == len(waypoints)-1 {
			line := make([][]float64, len(goalLine))
			for j, p := range goalLine {
				line[j] = []float64{p.Lon, p.Lat}
			}
			features[i] = geojson.NewLineStringFeature(line)
			continue
		}
		features[i] = createCircle(waypoint.LatLng.Lon, waypoint.LatLng.Lat, waypoint.Radius)
	}
	return features
}

func createLine(waypoints []types.Waypoint) *geojson.Feature {
	line := make([][]float64, len(waypoints))
	for i, wp := range waypoints {
		line[i] = []float64{wp.LatLng.Lon, wp.LatLng.Lat}
	}
	return geojson.NewLineStringFeature(line)
}
