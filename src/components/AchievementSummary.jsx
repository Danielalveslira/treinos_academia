import { Box, Text } from '@primer/react'
import { TrophyIcon, ChecklistIcon, GraphIcon } from '@primer/octicons-react'
import { formatDate } from '../utils/format'

function Stat({ icon: Icon, value, label }) {
  return (
    <Box
      sx={{
        flex: '1 1 120px',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        bg: 'canvas.default',
        border: '1px solid',
        borderColor: 'accent.muted',
        borderRadius: 2,
        p: 2,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: '8px',
          bg: 'accent.emphasis',
          color: 'fg.onEmphasis',
        }}
      >
        {Icon && <Icon size={15} />}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Text sx={{ display: 'block', fontSize: 3, fontWeight: 'bold', lineHeight: 1 }}>
          {value}
        </Text>
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>{label}</Text>
      </Box>
    </Box>
  )
}

// Usado tanto na prévia de publicação (AchievementForm) quanto no feed (StatusCard),
// para a "conquista do dia" ter sempre a mesma cara — sem duplicar o layout em dois lugares.
export function AchievementSummary({ achievement }) {
  return (
    <Box
      sx={{
        bg: 'accent.subtle',
        border: '1px solid',
        borderColor: 'accent.muted',
        borderRadius: 2,
        p: 3,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: '10px',
            bg: 'accent.emphasis',
            color: 'fg.onEmphasis',
          }}
        >
          <TrophyIcon size={18} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Text sx={{ display: 'block', fontWeight: 'bold', fontSize: 1 }}>Conquista do dia</Text>
          <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
            {formatDate(new Date(`${achievement.day}T12:00:00`))}
          </Text>
        </Box>
      </Box>

      {achievement.text && (
        <Text
          sx={{
            display: 'block',
            fontSize: 1,
            fontStyle: 'italic',
            mb: 3,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          “{achievement.text}”
        </Text>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <Stat icon={ChecklistIcon} value={achievement.entries} label="registros de exercícios" />
        <Stat icon={GraphIcon} value={achievement.sets} label="séries realizadas" />
      </Box>
    </Box>
  )
}
