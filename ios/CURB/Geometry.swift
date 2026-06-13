import CoreLocation
import Foundation
import MapKit

enum CurbGeometry {
    static func offsetLine(_ coordinates: [CLLocationCoordinate2D], meters: Double, sign: Int) -> [CLLocationCoordinate2D] {
        guard sign != 0, coordinates.count >= 2, let first = coordinates.first else {
            return coordinates
        }

        let lat0 = first.latitude
        let lng0 = first.longitude
        let cosLat = max(cos(lat0 * .pi / 180), 0.000_001)

        func project(_ point: CLLocationCoordinate2D) -> CGPoint {
            CGPoint(
                x: (point.longitude - lng0) * cosLat * 111_320,
                y: (point.latitude - lat0) * 111_320
            )
        }

        func unproject(_ point: CGPoint) -> CLLocationCoordinate2D {
            CLLocationCoordinate2D(
                latitude: lat0 + point.y / 111_320,
                longitude: lng0 + point.x / (cosLat * 111_320)
            )
        }

        let projected = coordinates.map(project)
        return projected.enumerated().map { index, point in
            let previous = projected[max(0, index - 1)]
            let next = projected[min(projected.count - 1, index + 1)]
            var dx = next.x - previous.x
            var dy = next.y - previous.y
            let length = max(hypot(dx, dy), 0.000_001)
            dx /= length
            dy /= length
            return unproject(
                CGPoint(
                    x: point.x + dy * meters * Double(sign),
                    y: point.y + (-dx) * meters * Double(sign)
                )
            )
        }
    }

    static func squaredDistanceMeters(from coordinate: CLLocationCoordinate2D, toLine line: [CLLocationCoordinate2D]) -> Double {
        guard !line.isEmpty else { return .infinity }
        if line.count == 1 {
            let p = metersProject(origin: coordinate, point: line[0])
            return p.x * p.x + p.y * p.y
        }

        var best = Double.infinity
        for index in 1..<line.count {
            let a = metersProject(origin: coordinate, point: line[index - 1])
            let b = metersProject(origin: coordinate, point: line[index])
            let vx = b.x - a.x
            let vy = b.y - a.y
            let lengthSquared = max(vx * vx + vy * vy, 0.000_001)
            let t = max(0, min(1, (-(a.x * vx + a.y * vy)) / lengthSquared))
            let x = a.x + vx * t
            let y = a.y + vy * t
            best = min(best, x * x + y * y)
        }
        return best
    }

    static func boundingBox(for coordinates: [CLLocationCoordinate2D], padding: Double) -> CoordinateBounds? {
        guard !coordinates.isEmpty else { return nil }
        var minLat = 90.0
        var maxLat = -90.0
        var minLng = 180.0
        var maxLng = -180.0
        for coordinate in coordinates {
            minLat = min(minLat, coordinate.latitude)
            maxLat = max(maxLat, coordinate.latitude)
            minLng = min(minLng, coordinate.longitude)
            maxLng = max(maxLng, coordinate.longitude)
        }
        return CoordinateBounds(
            south: minLat - padding,
            north: maxLat + padding,
            west: minLng - padding,
            east: maxLng + padding
        )
    }

    static func polygonWKT(for region: MKCoordinateRegion, padFraction: Double = 0.15) -> String {
        let latPad = region.span.latitudeDelta * padFraction
        let lngPad = region.span.longitudeDelta * padFraction
        let west = region.center.longitude - region.span.longitudeDelta / 2 - lngPad
        let east = region.center.longitude + region.span.longitudeDelta / 2 + lngPad
        let south = region.center.latitude - region.span.latitudeDelta / 2 - latPad
        let north = region.center.latitude + region.span.latitudeDelta / 2 + latPad
        return "POLYGON((\(west) \(south), \(east) \(south), \(east) \(north), \(west) \(north), \(west) \(south)))"
    }

    private static func metersProject(origin: CLLocationCoordinate2D, point: CLLocationCoordinate2D) -> CGPoint {
        let cosLat = max(cos(origin.latitude * .pi / 180), 0.000_001)
        return CGPoint(
            x: (point.longitude - origin.longitude) * cosLat * 111_320,
            y: (point.latitude - origin.latitude) * 111_320
        )
    }
}

struct CoordinateBounds {
    let south: Double
    let north: Double
    let west: Double
    let east: Double

    var polygonWKT: String {
        "POLYGON((\(west) \(south), \(east) \(south), \(east) \(north), \(west) \(north), \(west) \(south)))"
    }
}
