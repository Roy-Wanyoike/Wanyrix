import { NextResponse } from 'next/server'
import { ISSUES } from '@/lib/wanyrix/data'

export async function GET() {
  return NextResponse.json({ issues: ISSUES })
}
