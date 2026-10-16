import type { JSX } from 'preact'

interface IconProps {
  size?: number
  class?: string
}

function Svg({ size = 16, class: cls, children }: IconProps & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const IconBoard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="5" height="16" rx="1" />
    <rect x="10" y="4" width="5" height="11" rx="1" />
    <rect x="17" y="4" width="4" height="14" rx="1" />
  </Svg>
)

export const IconList = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </Svg>
)

export const IconTarget = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
  </Svg>
)

export const IconLayers = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
)

export const IconPulse = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h3l2.5-7 4 14 2.5-7h6" />
  </Svg>
)

export const IconSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconMinus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m16.5 16.5 4 4" />
  </Svg>
)

export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
)

export const IconGrip = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" stroke-width="2.4" />
  </Svg>
)

export const IconBranch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="5" r="2" />
    <circle cx="7" cy="19" r="2" />
    <circle cx="17" cy="9" r="2" />
    <path d="M7 7v10M9 7h4a4 4 0 0 1 4 4v0" />
  </Svg>
)

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2.5H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </Svg>
)

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 12.5 5 5L20 6.5" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </Svg>
)

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v5h-5" />
  </Svg>
)

export const IconBlocked = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </Svg>
)

export const IconFlag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V4M5 4h11l-1.5 4L16 12H5" />
  </Svg>
)

export const IconBug = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 8a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0Z" />
    <path d="M4 10h4M16 10h4M4 15h4M16 15h4M9 20l1-2M15 20l-1-2M9 4 8 2M15 4l1-2" />
  </Svg>
)

export const IconSpike = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

export const IconChore = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.7 6.3a4 4 0 0 1 5 5L9 22l-5-5Z" />
    <path d="m4 15 2-2" />
  </Svg>
)

export const IconStory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h9l5 5v11H5Z" />
    <path d="M14 4v5h5" />
  </Svg>
)

export const IconWarn = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4 2.5 20h19Z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
)

export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.4 1.4" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.4-1.4" />
  </Svg>
)

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4l11-11-4-4L4 16Z" />
    <path d="m14 5 4 4" />
  </Svg>
)

export const IconPalette = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H13a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3.3-4-6-9-6Z" />
    <circle cx="8" cy="10" r="1.2" />
    <circle cx="12" cy="7.5" r="1.2" />
  </Svg>
)

export const IconKeyboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </Svg>
)

export const IconTerminal = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="19" height="16" rx="2" />
    <path d="m7 10 2.5 2.5L7 15M12.5 15H17" />
  </Svg>
)

export const IconSort = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h12M4 12h8M4 17h4" />
  </Svg>
)

export const ICON_FOR_TYPE = {
  story: IconStory,
  bug: IconBug,
  chore: IconChore,
  spike: IconSpike,
} as const
