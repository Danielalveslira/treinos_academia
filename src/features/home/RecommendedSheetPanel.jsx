import { useState } from 'react'
import { DASHBOARD_BANNER_PHOTOS } from './dashboardBanners.js'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { Button, Heading, Spinner } from '@primer/react'
import {
  CalendarIcon,
  ChecklistIcon,
  ChevronRightIcon,
  ClockIcon,
  GraphIcon,
  PlayIcon,
  PulseIcon,
} from '@primer/octicons-react'
import { ResponsivePicture } from '../../components/ResponsivePicture'
import { originState } from '../../utils/navigation'
import { businessDayKey } from '../../utils/businessDate'
import { WEEKDAYS } from '../workoutSheets/workoutSheetValidation.js'
import { relativeDayLabel } from './recommendSheet.js'
import { useDailyBanner } from './useDailyBanner.js'
import { useSheetInsights } from './useSheetInsights.js'
import { ErrorState } from '../../components/ErrorState'

function weekdaysLabel(weekdays) {
  if (!weekdays?.length) return null
  return [...weekdays]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAYS[day])
    .join(', ')
}

function InsightCard({ eyebrow, title, detail, to, icon: IconComponent }) {
  return (
    <RouterLink to={to} className="sheet-insight-card">
      <span className="sheet-insight-icon">{IconComponent && <IconComponent size={16} />}</span>
      <span className="sheet-insight-text">
        <span className="sheet-insight-eyebrow">{eyebrow}</span>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <ChevronRightIcon size={14} className="sheet-insight-chevron" />
    </RouterLink>
  )
}

function SheetActivityCards({ lastTrained, mostTrained, todayKey }) {
  return (
    (lastTrained || mostTrained) && (
      <div className="sheet-insights-row">
        {lastTrained && (
          <InsightCard
            icon={PulseIcon}
            eyebrow="ÚLTIMA FICHA UTILIZADA"
            title={lastTrained.sheet.name}
            detail={relativeDayLabel(lastTrained.date, todayKey)}
            to={`/fichas/${lastTrained.sheet.id}`}
          />
        )}
        {mostTrained && (
          <InsightCard
            icon={GraphIcon}
            eyebrow="MAIS DIAS COM REGISTROS"
            title={mostTrained.sheet.name}
            detail={`${mostTrained.count} ${mostTrained.count === 1 ? 'dia com registros' : 'dias com registros'} neste mês`}
            to={`/fichas/${mostTrained.sheet.id}`}
          />
        )}
      </div>
    )
  )
}

function HeroPhoto({ photo }) {
  const [failed, setFailed] = useState([])
  const current = [photo, ...DASHBOARD_BANNER_PHOTOS.filter((p) => p.name !== photo.name)].find(
    (p) => !failed.includes(p.name)
  )
  return current ? (
    <ResponsivePicture
      name={current.name}
      alt={current.alt}
      width={current.width}
      height={current.height}
      sizes="(max-width: 767px) 100vw, 60vw"
      priority
      onError={() => setFailed((previous) => [...previous, current.name])}
    />
  ) : null
}

export function RecommendedSheetPanel() {
  const navigate = useNavigate()
  const location = useLocation()
  const { online, loading, error, hasSheets, recommendation, lastTrained, mostTrained, refresh } =
    useSheetInsights()
  const photo = useDailyBanner()
  const todayKey = businessDayKey()

  if (loading) {
    return (
      <section className="workout-hero workout-hero--loading" aria-label="Carregando recomendação">
        <Spinner />
      </section>
    )
  }

  if (!online) {
    return (
      <section className="empty-workout" aria-labelledby="sheet-offline-title">
        <div className="empty-workout-content">
          <span className="eyebrow">SUAS FICHAS</span>
          <Heading as="h1" id="sheet-offline-title">
            Indisponível offline
          </Heading>
          <p>
            A recomendação de ficha precisa de conexão. Seus registros continuam salvos normalmente.
          </p>
          <Button
            className="empty-workout-cta"
            leadingVisual={PlayIcon}
            onClick={() => navigate('/novo-treino', { state: originState(location) })}
          >
            Treino livre
          </Button>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="empty-workout" aria-labelledby="sheet-error-title">
        <div className="empty-workout-content">
          <span className="eyebrow">SUAS FICHAS</span>
          <Heading as="h1" id="sheet-error-title">
            Não foi possível carregar suas fichas
          </Heading>
          <ErrorState error={error} onRetry={refresh} />
        </div>
      </section>
    )
  }

  if (!hasSheets) {
    return (
      <section className="empty-workout" aria-labelledby="empty-workout-title">
        <div className="empty-workout-content">
          <span className="eyebrow">COMECE HOJE</span>
          <Heading as="h1" id="empty-workout-title">
            Monte sua primeira ficha.
          </Heading>
          <p>Organize exercícios e metas por treino e comece a receber recomendações aqui.</p>
          <Button
            className="empty-workout-cta"
            variant="primary"
            leadingVisual={ChecklistIcon}
            onClick={() => navigate('/fichas/nova', { state: originState(location) })}
          >
            Criar primeira ficha
          </Button>
        </div>
      </section>
    )
  }

  if (!recommendation) {
    return (
      <section className="empty-workout" aria-labelledby="empty-eligible-title">
        <div className="empty-workout-content">
          <span className="eyebrow">SUAS FICHAS</span>
          <Heading as="h1" id="empty-eligible-title">
            Revise suas fichas para treinar.
          </Heading>
          <p>
            As fichas estão vazias ou contêm exercícios indisponíveis. Revise os exercícios para
            receber uma recomendação.
          </p>
          <Button
            className="empty-workout-cta"
            leadingVisual={ChecklistIcon}
            onClick={() => navigate('/exercicios', { state: originState(location) })}
          >
            Ver fichas
          </Button>
          <SheetActivityCards
            lastTrained={lastTrained}
            mostTrained={mostTrained}
            todayKey={todayKey}
          />
          <p>
            Indicadores mostram dias com atividade registrada, sem comprovar conclusão. Registros da
            fila offline não entram nestes indicadores.
          </p>
        </div>
      </section>
    )
  }

  const { sheet, reason, lastDate } = recommendation
  const days = weekdaysLabel(sheet.weekdays)
  const lastLabel = relativeDayLabel(lastDate, todayKey)

  return (
    <section className="workout-hero" aria-labelledby="next-workout-title">
      {photo && <HeroPhoto key={`${todayKey}:${photo.name}`} photo={photo} />}
      <div className="workout-hero-shade" />
      <div className="workout-hero-content">
        <span className="hero-kicker">
          <PulseIcon size={14} /> PRÓXIMA FICHA RECOMENDADA
          {reason === 'today' && lastDate !== todayKey && (
            <span className="hero-today-pill">Recomendado para hoje</span>
          )}
        </span>
        <Heading as="h2" id="next-workout-title">
          {sheet.name}
        </Heading>
        {(days || lastLabel) && (
          <p className="workout-hero-meta">
            {days && (
              <span>
                <CalendarIcon size={14} /> Próximo treino sugerido · <strong>{days}</strong>
              </span>
            )}
            {lastLabel && (
              <span>
                <ClockIcon size={14} /> Última atividade <strong>{lastLabel}</strong>
              </span>
            )}
          </p>
        )}
        {lastDate === todayKey && <p>Esta ficha já tem atividade registrada hoje.</p>}
        <div className="workout-hero-actions">
          <Button
            as={RouterLink}
            to={`/novo-treino?ficha=${sheet.id}`}
            state={originState(location)}
            className="start-workout-button"
            leadingVisual={PlayIcon}
            variant="primary"
          >
            Iniciar ficha
          </Button>
          <Button as={RouterLink} to="/exercicios" leadingVisual={ChecklistIcon}>
            Ver fichas
          </Button>
        </div>
        <SheetActivityCards
          lastTrained={lastTrained}
          mostTrained={mostTrained}
          todayKey={todayKey}
        />
        <p className="sheet-insights-disclosure">
          Atividade registrada não comprova conclusão da ficha. Novos registros salvos apenas offline
          não são vinculados à ficha e ficam fora destes indicadores.
        </p>
      </div>
    </section>
  )
}
