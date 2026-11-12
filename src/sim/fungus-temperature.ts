export interface FungusTemperatureResponse {
  readonly kind: "triangular";
  readonly min_c: number;
  readonly optimum_c: number;
  readonly max_c: number;
}

/** Creates F(T) from versioned balance data. Temperatures are in degrees Celsius. */
export function createFungusTemperatureFactor(
  response: FungusTemperatureResponse,
): (temperatureC: number) => number {
  const { kind, min_c: minimum, optimum_c: optimum, max_c: maximum } = response;

  if (
    kind !== "triangular" ||
    ![minimum, optimum, maximum].every(Number.isFinite) ||
    !(minimum < optimum && optimum < maximum)
  ) {
    throw new RangeError("Expected a finite triangular curve with min < optimum < max");
  }

  return (temperatureC: number): number => {
    if (!Number.isFinite(temperatureC)) {
      throw new RangeError("Temperature must be a finite number in degrees Celsius");
    }
    if (temperatureC <= minimum || temperatureC >= maximum) return 0;
    if (temperatureC <= optimum) {
      return (temperatureC - minimum) / (optimum - minimum);
    }
    return (maximum - temperatureC) / (maximum - optimum);
  };
}
