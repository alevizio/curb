import CoreLocation
import Foundation

struct SweepRow: Decodable, Identifiable, SweepRuleRepresentable {
    let cnn: String?
    let corridor: String?
    let limits: String?
    let blockside: String?
    let cnnrightleft: String?
    let weekday: String?
    let fromhour: String?
    let tohour: String?
    let week1: String?
    let week2: String?
    let week3: String?
    let week4: String?
    let week5: String?
    let holidays: String?
    let line: GeoLine?

    var id: String {
        [
            cnn ?? UUID().uuidString,
            blockside ?? cnnrightleft ?? "C",
            weekday ?? "",
            fromhour ?? "",
            tohour ?? ""
        ].joined(separator: "|")
    }
}

struct GeoLine: Decodable {
    let type: String?
    let coordinates: [[Double]]

    var locations: [CLLocationCoordinate2D] {
        coordinates.compactMap { point in
            guard point.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: point[1], longitude: point[0])
        }
    }
}

struct RPPRow: Decodable {
    let rpparea1: String?
    let hrlimit: String?
    let days: String?
    let fromTime: String?
    let toTime: String?
    let regulation: String?
    let exceptions: String?
    let shape: StreetShape?

    enum CodingKeys: String, CodingKey {
        case rpparea1
        case hrlimit
        case days
        case fromTime = "from_time"
        case toTime = "to_time"
        case regulation
        case exceptions
        case shape
    }
}

struct RPPHint: Equatable {
    let area: String
    let hourLimit: String?
    let days: String?
    let fromTime: String?
    let toTime: String?
}

enum StreetShape: Decodable {
    case line([CLLocationCoordinate2D])
    case multiLine([[CLLocationCoordinate2D]])

    enum CodingKeys: String, CodingKey {
        case type
        case coordinates
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        if type == "LineString" {
            let raw = try container.decode([[Double]].self, forKey: .coordinates)
            self = .line(Self.convert(raw))
        } else {
            let raw = try container.decode([[[Double]]].self, forKey: .coordinates)
            self = .multiLine(raw.map(Self.convert))
        }
    }

    var lines: [[CLLocationCoordinate2D]] {
        switch self {
        case .line(let line): [line]
        case .multiLine(let lines): lines
        }
    }

    private static func convert(_ raw: [[Double]]) -> [CLLocationCoordinate2D] {
        raw.compactMap { point in
            guard point.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: point[1], longitude: point[0])
        }
    }
}

struct CountRow: Decodable {
    let count: String?
    let c: String?
}

struct AddressRow: Decodable {
    let address: String?
    let addressNumber: String?
    let streetName: String?
    let streetType: String?
    let latitude: String?
    let longitude: String?
    let cnn: String?

    enum CodingKeys: String, CodingKey {
        case address
        case addressNumber = "address_number"
        case streetName = "street_name"
        case streetType = "street_type"
        case latitude
        case longitude
        case cnn
    }

    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude, let lat = Double(latitude), let lng = Double(longitude) else {
            return nil
        }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

struct StreetSearchRow: Decodable {
    let corridor: String?
    let line: GeoLine?
}

struct NormalizedAddress {
    let number: String
    let street: String
}

struct CurbGroup: Identifiable {
    let cnn: String
    let corridor: String
    let limits: String
    var sides: [CurbSide]

    var id: String { cnn }
}

struct CurbSide: Identifiable {
    let id: String
    let key: String
    let blockside: String
    let rows: [SweepRow]
    let displayRow: SweepRow?
    let nextSweep: SweepWindow?
    let status: CurbStatus
    let coordinates: [CLLocationCoordinate2D]
    let midpoint: CLLocationCoordinate2D
}

struct CurbOverlayItem: Identifiable {
    let id: String
    let coordinates: [CLLocationCoordinate2D]
    let status: CurbStatus
}

struct CurbSelection: Identifiable {
    let group: CurbGroup
    let side: CurbSide
    var meterCount: Int?
    var rpp: RPPHint?

    var id: String {
        let stamp = side.nextSweep?.start.timeIntervalSince1970 ?? 0
        return "\(group.cnn)|\(side.key)|\(stamp)"
    }
}

struct SearchSuggestion: Identifiable, Equatable {
    enum Kind {
        case address(AddressRow)
        case street(StreetSearchRow)
    }

    let id = UUID()
    let title: String
    let kind: Kind

    static func == (lhs: SearchSuggestion, rhs: SearchSuggestion) -> Bool {
        lhs.id == rhs.id
    }
}
