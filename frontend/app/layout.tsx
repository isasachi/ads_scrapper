export const metadata = {
  title: "Meta Winner Finder",
  description: "Pipeline multiagente para descubrir productos ganadores",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
