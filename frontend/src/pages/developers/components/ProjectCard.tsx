import { motion } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBuilding, faCheck, faCircleCheck, faHome, faLocationDot } from '@fortawesome/free-solid-svg-icons'
import { ScrapedRecord } from '../../../types'
import { heroImage } from '../helpers/media'
import {
  extractTitle, extractLocation, extractPrice, extractStatus,
  recordStatusLabel, statusClass,
} from '../helpers/extractors'

interface Props {
  record: ScrapedRecord
  selected: boolean
  childCount: number
  onClick: () => void
}

export default function ProjectCard({ record, selected, childCount, onClick }: Props) {
  const d      = record.data || {}
  const status = extractStatus(d) || recordStatusLabel(record.status)
  const img    = heroImage(d)

  return (
    <motion.div
      layout onClick={onClick}
      whileHover={{ y: -2, transition: { duration: 0.1 } }}
      className={`relative rounded-xl border overflow-hidden cursor-pointer bg-white transition-shadow ${
        selected
          ? 'border-blue-500 ring-2 ring-blue-200 shadow-md'
          : 'border-gray-200 hover:border-blue-300 hover:shadow-sm'
      }`}
    >
      {selected && (
        <div className="absolute top-2.5 right-2.5 z-10 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center shadow">
          <FontAwesomeIcon icon={faCheck} className="text-white text-[10px]" />
        </div>
      )}

      <div className="h-44 bg-gray-100 overflow-hidden">
        {img
          ? <img src={img} alt="" className="w-full h-full object-cover transition-transform duration-300 hover:scale-105" />
          : <div className="w-full h-full bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center">
              <FontAwesomeIcon icon={faBuilding} className="text-4xl text-gray-300" />
            </div>
        }
      </div>

      <div className="p-4">
        <div className="mb-2">
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${statusClass(status)}`}>
            <FontAwesomeIcon icon={faCircleCheck} className="text-[9px]" />
            {status}
          </span>
        </div>
        <h3 className="font-bold text-gray-900 text-sm leading-snug mb-2 line-clamp-2">{extractTitle(d)}</h3>
        <div className="space-y-1 text-xs text-gray-500">
          {extractLocation(d) && (
            <div className="flex items-center gap-1.5">
              <FontAwesomeIcon icon={faLocationDot} className="text-gray-400 w-3 flex-shrink-0" />
              <span className="truncate">{extractLocation(d)}</span>
            </div>
          )}
          {extractPrice(d) && (
            <div className="flex items-center gap-1.5 font-medium text-gray-700">
              <span className="w-3 text-center text-gray-400">S/</span>
              Desde {extractPrice(d)}
            </div>
          )}
          {childCount > 0 && (
            <div className="flex items-center gap-1.5">
              <FontAwesomeIcon icon={faHome} className="text-gray-400 w-3 flex-shrink-0" />
              <span>{childCount} propiedades</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
