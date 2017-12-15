using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Evolution
{
    public class MatchConfig
    {
        public int Id;

        public float MatchTimeout = 10000;

        public float WinnerPollPeriod = 1;
    }
}
