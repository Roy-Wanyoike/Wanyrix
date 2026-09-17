import { NextResponse } from 'next/server'
import { EXPERIMENTS } from '@/lib/ferrix/data'

export async function GET() {
  return NextResponse.json({ experiments: EXPERIMENTS })
}
