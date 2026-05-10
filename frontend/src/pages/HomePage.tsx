import { ApiStatus } from '../components/ApiStatus'

export default function HomePage() {
  return (
    <div className="py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Bienvenido a PropScraper
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Sistema de administración y extracción de datos inmobiliarios
          </p>
        </div>

        <div className="mb-8">
          <ApiStatus />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="font-bold text-lg mb-2">Desarrolladoras</h3>
            <p className="text-gray-600">
              Registra y administra plataformas inmobiliarias
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="font-bold text-lg mb-2">Plantillas</h3>
            <p className="text-gray-600">
              Configura selectores CSS para extraer datos
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="font-bold text-lg mb-2">Trabajos</h3>
            <p className="text-gray-600">
              Monitorea el progreso de los scrapers automáticos
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
