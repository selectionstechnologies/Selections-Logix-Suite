// Recharts wrappers with one visual system: thin marks, recessive grid, one axis, legends
// for 2+ series. Palette limited to the brand's yellow/red plus neutrals, chosen with the
// colour validator: adjacent pairs clear the CVD target, and identity is backed by legends.
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

export const CHART = { yellow: '#CA8A04', red: '#DC2626', slate: '#566A85', brown: '#92400E' };
const SERIES = [CHART.yellow, CHART.red, CHART.slate, CHART.brown];
const AXIS = { fontSize: 11, fill: '#6B7280' };
const GRID = '#F3F4F6';

function ChartTooltip({ active, payload, label, format }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-pop">
      {label !== undefined && <p className="mb-1 font-semibold">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey || p.name} className="flex items-center gap-2 text-gray-700">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} aria-hidden />
          {p.name}: <span className="font-semibold text-ink">{format ? format(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

const Empty = () => <div className="flex h-full items-center justify-center text-sm text-ink-muted">No data for this selection</div>;

const legendStyle = { fontSize: 12, color: '#374151' };

/** series: [{ key, name, color? }] */
export function BarsChart({ data, xKey = 'name', series, height = 260, format, horizontal, stacked }) {
  if (!data?.length) return <div style={{ height }}><Empty /></div>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid stroke={GRID} vertical={!!horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={format} />
              <YAxis type="category" dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} width={120} interval={0} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} minTickGap={12} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={format} />
            </>
          )}
          <Tooltip cursor={{ fill: '#F9FAFB' }} content={<ChartTooltip format={format} />} />
          {series.length > 1 && <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId={stacked ? 'a' : undefined} fill={s.color || SERIES[i]} maxBarSize={28} radius={stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LinesChart({ data, xKey = 'label', series, height = 260, format }) {
  if (!data?.length) return <div style={{ height }}><Empty /></div>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={format} />
          <Tooltip content={<ChartTooltip format={format} />} />
          {series.length > 1 && <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />}
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.name} type="monotone" stroke={s.color || SERIES[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AreaTrend({ data, xKey = 'label', dataKey, name, height = 260, format, color = CHART.yellow }) {
  if (!data?.length) return <div style={{ height }}><Empty /></div>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={format} allowDecimals={false} />
          <Tooltip content={<ChartTooltip format={format} />} />
          <Area dataKey={dataKey} name={name} type="monotone" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.14} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ data, height = 260, format, colors = SERIES }) {
  if (!data?.length) return <div style={{ height }}><Empty /></div>;
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="#fff" strokeWidth={2}>
            {data.map((d, i) => <Cell key={d.name} fill={d.color || colors[i % colors.length]} />)}
          </Pie>
          <Tooltip content={<ChartTooltip format={format} />} />
          <Legend
            wrapperStyle={legendStyle}
            iconType="circle"
            iconSize={8}
            formatter={(value, entry) => `${value} (${total ? Math.round((entry.payload.value / total) * 100) : 0}%)`}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
