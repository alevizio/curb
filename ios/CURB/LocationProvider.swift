import CoreLocation
import Foundation

@MainActor
final class LocationProvider: NSObject, @MainActor CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waitingForAuthorization = false

    var onResult: ((Result<CLLocation, Error>) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .otherNavigation
    }

    func requestLocation() {
        switch manager.authorizationStatus {
        case .notDetermined:
            waitingForAuthorization = true
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            requestPreciseLocation()
        case .denied:
            onResult?(.failure(LocationProviderError.denied))
        case .restricted:
            onResult?(.failure(LocationProviderError.restricted))
        @unknown default:
            onResult?(.failure(LocationProviderError.unavailable))
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations
            .filter({ $0.horizontalAccuracy >= 0 && abs($0.timestamp.timeIntervalSinceNow) <= 45 })
            .min(by: { $0.horizontalAccuracy < $1.horizontalAccuracy })
        else {
            onResult?(.failure(LocationProviderError.stale))
            return
        }

        if #available(iOS 14.0, *), manager.accuracyAuthorization == .reducedAccuracy {
            onResult?(.failure(LocationProviderError.reducedAccuracy))
            return
        }

        guard location.horizontalAccuracy <= 100 else {
            onResult?(.failure(LocationProviderError.inaccurate(location.horizontalAccuracy)))
            return
        }

        onResult?(.success(location))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        onResult?(.failure(error))
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard waitingForAuthorization else { return }

        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            waitingForAuthorization = false
            requestPreciseLocation()
        case .denied:
            waitingForAuthorization = false
            onResult?(.failure(LocationProviderError.denied))
        case .restricted:
            waitingForAuthorization = false
            onResult?(.failure(LocationProviderError.restricted))
        case .notDetermined:
            break
        @unknown default:
            waitingForAuthorization = false
            onResult?(.failure(LocationProviderError.unavailable))
        }
    }

    private func requestPreciseLocation() {
        manager.desiredAccuracy = kCLLocationAccuracyBest

        if #available(iOS 14.0, *), manager.accuracyAuthorization == .reducedAccuracy {
            manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "PreciseCurbLocation") { [weak self] _ in
                Task { @MainActor in
                    self?.manager.requestLocation()
                }
            }
            return
        }

        manager.requestLocation()
    }
}

enum LocationProviderError: LocalizedError {
    case denied
    case restricted
    case reducedAccuracy
    case inaccurate(CLLocationAccuracy)
    case stale
    case unavailable

    var errorDescription: String? {
        switch self {
        case .denied:
            return "Location is off for CURB. In Settings, allow location access."
        case .restricted:
            return "Location is restricted on this device."
        case .reducedAccuracy:
            return "Precise Location is off. In Settings > CURB > Location, turn on Precise Location."
        case .inaccurate(let accuracy):
            return "Location was too broad (±\(Int(accuracy))m). Turn on Precise Location and try again."
        case .stale:
            return "Could not get a fresh GPS fix. Step outside or try again."
        case .unavailable:
            return "Location is unavailable right now."
        }
    }
}
