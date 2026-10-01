/** Browser-safe RR-004 projection types. No service-role or command imports. */
export type DriverRouteTask = {
  routeRunId: string;
  executionId: string;
  title: string;
  state: string;
  currentSequence: number;
  stopCount: number;
  stops: Array<{
    sequence: number;
    deliveryId: string;
    fulfillmentState: string;
    packageDescription: string | null;
    packageCount: number | null;
  }>;
};

export type DriverRouteAction =
  "start_pickup" | "arrive_pickup" | "depart_pickup" | "advance_stop" | "complete_route";
