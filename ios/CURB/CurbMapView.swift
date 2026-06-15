import CoreLocation
import MapKit
import SwiftUI
import UIKit

struct CurbMapView: UIViewRepresentable {
    let overlays: [CurbOverlayItem]
    let parkedCoordinate: CLLocationCoordinate2D?
    let cameraRequest: CameraRequest?
    let initialRegion: MKCoordinateRegion
    var onRegionChanged: (MKCoordinateRegion) -> Void
    var onTap: (CLLocationCoordinate2D) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView(frame: .zero)
        mapView.delegate = context.coordinator
        mapView.mapType = .standard
        mapView.pointOfInterestFilter = .excludingAll
        mapView.showsCompass = false
        mapView.showsScale = false
        mapView.showsUserLocation = true
        mapView.setRegion(initialRegion, animated: false)

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.cancelsTouchesInView = false
        mapView.addGestureRecognizer(tap)

        context.coordinator.mapView = mapView
        context.coordinator.render(overlays, on: mapView)
        context.coordinator.updateParkedAnnotation(parkedCoordinate, on: mapView)
        return mapView
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.render(overlays, on: mapView)
        context.coordinator.updateParkedAnnotation(parkedCoordinate, on: mapView)

        if let cameraRequest, context.coordinator.lastCameraRequestID != cameraRequest.id {
            context.coordinator.lastCameraRequestID = cameraRequest.id
            mapView.setRegion(cameraRequest.region, animated: true)
        }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: CurbMapView
        weak var mapView: MKMapView?
        var renderedIDs: Set<String> = []
        var lastCameraRequestID: UUID?
        private var parkedAnnotation: MKPointAnnotation?

        init(parent: CurbMapView) {
            self.parent = parent
        }

        func render(_ items: [CurbOverlayItem], on mapView: MKMapView) {
            let nextIDs = Set(items.map(\.id))
            guard nextIDs != renderedIDs else { return }

            let old = mapView.overlays.compactMap { $0 as? CurbPolyline }
            mapView.removeOverlays(old)

            let polylines = items.compactMap { item -> CurbPolyline? in
                guard item.coordinates.count >= 2 else { return nil }
                var coordinates = item.coordinates
                let polyline = CurbPolyline(coordinates: &coordinates, count: coordinates.count)
                polyline.curbID = item.id
                polyline.strokeColor = item.status.uiColor
                return polyline
            }
            mapView.addOverlays(polylines, level: .aboveRoads)
            renderedIDs = nextIDs
        }

        func updateParkedAnnotation(_ coordinate: CLLocationCoordinate2D?, on mapView: MKMapView) {
            guard let coordinate else {
                if let parkedAnnotation {
                    mapView.removeAnnotation(parkedAnnotation)
                    self.parkedAnnotation = nil
                }
                return
            }

            if let parkedAnnotation {
                parkedAnnotation.coordinate = coordinate
            } else {
                let annotation = MKPointAnnotation()
                annotation.coordinate = coordinate
                annotation.title = "Parked here"
                mapView.addAnnotation(annotation)
                parkedAnnotation = annotation
            }
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended, let mapView else { return }
            let point = recognizer.location(in: mapView)
            let coordinate = mapView.convert(point, toCoordinateFrom: mapView)
            parent.onTap(coordinate)
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            parent.onRegionChanged(mapView.region)
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let polyline = overlay as? CurbPolyline else {
                return MKOverlayRenderer(overlay: overlay)
            }
            let renderer = MKPolylineRenderer(polyline: polyline)
            renderer.strokeColor = polyline.strokeColor
            renderer.lineWidth = 5.5
            renderer.alpha = 0.95
            renderer.lineJoin = .round
            renderer.lineCap = .round
            return renderer
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard !(annotation is MKUserLocation) else { return nil }
            let identifier = "parked"
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: identifier) ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: identifier)
            view.annotation = annotation
            if let marker = view as? MKMarkerAnnotationView {
                marker.markerTintColor = CurbTheme.uiInk
                marker.glyphText = "P"
                marker.glyphTintColor = CurbTheme.uiPaper
                marker.titleVisibility = .hidden
                marker.subtitleVisibility = .hidden
            }
            return view
        }
    }
}

final class CurbPolyline: MKPolyline {
    var curbID = ""
    var strokeColor = CurbTheme.uiGray
}
