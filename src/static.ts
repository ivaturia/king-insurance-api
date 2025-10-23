export const customers = [
  {
    customer_id: "cust-001",
    person: {
      first_name: "John",
      last_name: "Sherman",
      dob: "1980-05-10",
      email: "John@example.com",
      phone: "+1-301-555-1122",
      address1: "123 Maple Ave",
      city: "Clarksburg",
      state: "MD",
      zipcode: "20871",
      prior_insurance: true,
      lapse_days: 0,
      home_owner: true
    },
    drivers: [
      { first_name:"John", last_name:"Sherman", dob:"1980-05-10", license_state:"MD",
        years_licensed: 10, accidents_last_5y: 0, violations_last_3y: 0 }
    ],
    vehicles: [
      { vin:"JT4BG22K6Y0123456", year:2011, make:"Toyota", model:"Camry",
        ownership:"own", primary_use:"commute", annual_miles:12000, garaging_zip:"20871" }
    ]
  },
  {
    customer_id: "cust-002",
    person: {
      first_name: "Rhea",
      last_name: "Patel",
      dob: "1990-04-12",
      email: "rhea@example.com",
      phone: "+1-469-555-7788",
      address1: "55 Meadow Ln",
      city: "Frisco",
      state: "TX",
      zipcode: "75035",
      prior_insurance: true,
      lapse_days: 0,
      home_owner: false
    },
    drivers: [
      { first_name:"Rhea", last_name:"Patel", dob:"1990-04-12", license_state:"TX",
        years_licensed: 6, accidents_last_5y: 1, violations_last_3y: 0 }
    ],
    vehicles: [
      { year:2020, make:"Honda", model:"Odyssey",
        ownership:"finance", primary_use:"pleasure", annual_miles:9000, garaging_zip:"75035" }
    ]
  }
];

export const quotesStore: Record<string, any> = {};
