import { describe, expect, it } from "vitest";
import { parseTickPickEventMappings } from "./tickpick";

describe("parseTickPickEventMappings", () => {
  it("extracts only Braves home events at Truist Park", () => {
    const html = `
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[
          {"@type":"SportsEvent","name":"Atlanta Braves vs. Washington Nationals",
           "startDate":"2026-07-31T19:15:00",
           "url":"https://www.tickpick.com/buy-atlanta-braves-vs-washington-nationals-tickets-truist-park-7-31-26-7pm/7368071/",
           "location":{"@type":"EventVenue","name":"Truist Park"}},
          {"@type":"SportsEvent","name":"Washington Nationals vs. Atlanta Braves",
           "startDate":"2026-09-01T18:45:00",
           "url":"https://www.tickpick.com/buy-away-event/9999999/",
           "location":{"@type":"EventVenue","name":"Nationals Park"}}
        ]}
      </script>`;

    expect(parseTickPickEventMappings(html)).toEqual([{
      sourceEventId: "7368071",
      url: "https://www.tickpick.com/buy-atlanta-braves-vs-washington-nationals-tickets-truist-park-7-31-26-7pm/7368071/",
      startsOn: "2026-07-31",
      eventName: "Atlanta Braves vs. Washington Nationals"
    }]);
  });

  it("fails closed on malformed structured data", () => {
    expect(parseTickPickEventMappings(
      '<script type="application/ld+json">{bad json}</script>'
    )).toEqual([]);
  });
});

