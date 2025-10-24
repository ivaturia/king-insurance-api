// src/static_quotes.ts
export const staticQuotes: Record<string, any> = {
  "89e2aefe-a42c-4f7b-80fb-3fce196bf18b": {
    "quote_id": "89e2aefe-a42c-4f7b-80fb-3fce196bf18b",
    "rated_person": {
      "first_name": "John",
      "last_name": "Sherman",
      "dob": "1980-05-10",
      "email": "john@example.com",
      "phone": "+1-301-555-1122",
      "address1": "123 Maple Ave",
      "city": "Clarksburg",
      "state": "MD",
      "zipcode": "20871",
      "prior_insurance": true,
      "lapse_days": 0,
      "home_owner": true
    },
    "rated_drivers": [
      {
        "first_name": "John",
        "last_name": "Sherman",
        "dob": "1980-05-10",
        "license_state": "MD",
        "years_licensed": 10,
        "accidents_last_5y": 0,
        "violations_last_3y": 0
      }
    ],
    "rated_vehicles": [
      {
        "vin": "JT4BG22K6Y0123456",
        "year": 2011,
        "make": "Toyota",
        "model": "Camry",
        "ownership": "own",
        "primary_use": "commute",
        "annual_miles": 12000,
        "garaging_zip": "20871"
      }
    ],
    "discounts_applied": ["Safe driver (5%)"],
    "premium_breakdown": {
      "per_vehicle": [
        {
          "year": 2011,
          "make": "Toyota",
          "model": "Camry",
          "base": 560,
          "surcharges": 0,
          "discounts": 28,
          "subtotal": 532
        }
      ],
      "policy_fee": 25,
      "state_surcharge": 10.92,
      "final_6mo": 581.75,
      "final_12mo": 1134.41
    },
    "created_at": "2025-10-23T18:23:42.842Z",
    "next_steps": "Review coverages and bind. A licensed agent will contact you to finalize."
  }
};
