"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const CHART_COLORS = ["#d32f2f", "#1976d2", "#388e3c", "#f57c00", "#7b1fa2", "#0097a7", "#c2185b", "#5d4037"];

type SignupsByDate = { date: string; count: number };
type CityCount = { name: string; value: number };

type Props = {
  signupsByDate: SignupsByDate[];
  cityCounts: CityCount[];
};

export default function AdminStats({ signupsByDate, cityCounts }: Props) {
  return (
    <div style={{ direction: "rtl", marginBottom: "24px" }}>
      <h3 style={{ borderBottom: "2px solid #d32f2f", paddingBottom: "5px", display: "inline-block", marginBottom: "12px" }}>
        📈 סטטיסטיקות
      </h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 400px", minWidth: 0, background: "#fff", padding: "16px", border: "1px solid #eee", borderRadius: "8px" }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: "15px" }}>רישומים לפי תאריך</h4>
          {signupsByDate.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={signupsByDate} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#d32f2f" name="רישומים" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: "#666", fontSize: "14px" }}>אין עדיין נתוני רישום.</p>
          )}
        </div>
        <div style={{ flex: "1 1 320px", minWidth: 0, background: "#fff", padding: "16px", border: "1px solid #eee", borderRadius: "8px" }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: "15px" }}>ערים</h4>
          {cityCounts.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={cityCounts}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {cityCounts.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [value, "לקוחות"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: "#666", fontSize: "14px" }}>אין נתוני ערים.</p>
          )}
        </div>
      </div>
    </div>
  );
}
