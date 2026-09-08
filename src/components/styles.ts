// Kept out of the component files so Fast Refresh keeps working: a module that
// exports anything other than components loses its HMR boundary.

const base =
  'rounded px-3 py-1.5 text-sm font-medium transition disabled:opacity-40'

export const buttonStyles = {
  primary: `${base} bg-slate-900 text-white enabled:hover:bg-slate-700`,
  danger: `${base} bg-red-600 text-white enabled:hover:bg-red-700`,
  quiet: `${base} border border-slate-300 enabled:hover:bg-slate-100`,
}

export const inputStyles =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none'
