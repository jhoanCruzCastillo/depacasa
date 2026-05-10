import Sidebar from './Sidebar'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto min-w-0">
        <div className="px-6 py-6 h-full">
          {children}
        </div>
      </main>
    </div>
  )
}
