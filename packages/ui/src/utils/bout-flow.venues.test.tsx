import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG } from '@myclash/types';
import { buildBoutFlow } from './bout-flow';
import { BOUT_FLOW_STYLES, boutFlowGeometry } from '../components/bout-flow-geometry';
import { Axes } from '../components/bout-flow-marks';

/** The bout-flow chart draws the point cap as its finish line; a venues bout has none. */
function chart(unit: 'points' | 'venues') {
  const series = buildBoutFlow({
    exchanges: [],
    penalties: [],
    redRegId: 'r',
    blueRegId: 'b',
    phaseType: 'pool',
    matchFormat: { ...DEFAULT_MATCH_FORMAT_CONFIG, scoringUnit: unit },
  });
  const styles = BOUT_FLOW_STYLES.compact;
  const geo = boutFlowGeometry(series, styles, (ms) => String(ms));
  const svg = renderToStaticMarkup(
    <svg>
      <Axes series={series} geo={geo} styles={styles} t={(k) => k} />
    </svg>,
  );
  return { series, geo, svg };
}

describe('the bout-flow cap line', () => {
  it('is drawn in a points bout', () => {
    const { series, geo, svg } = chart('points');
    expect(series.pointCap).toBe(DEFAULT_MATCH_FORMAT_CONFIG.pointCap);
    expect(geo.capY).not.toBeNull();
    expect(svg).toContain('stroke-dasharray');
  });

  it('is not drawn in a venues bout', () => {
    const { series, geo, svg } = chart('venues');
    expect(series.pointCap).toBeNull();
    expect(geo.capY).toBeNull();
    expect(svg).not.toContain('stroke-dasharray');
  });
});
