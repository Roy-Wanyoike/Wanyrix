import { NextResponse } from 'next/server'
import { GATES } from '@/lib/wanyrix/data'

export async function GET() {
  return NextResponse.json(GATES)
}
