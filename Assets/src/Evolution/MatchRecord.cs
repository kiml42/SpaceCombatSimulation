using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.src.Evolution
{
    public class MatchRecord
    {
        private const char Delimiter = ';';
        public string Victor;
        public string[] Competitors;

        public MatchRecord(string recordLine)
        {
            var parts = recordLine.Split(Delimiter);
            if(parts.Length >= 3)
            {
                //is normal line
                Competitors = new string[]
                {
                    parts[0],parts[1]
                };
                Victor = parts[2];
            }
            else if(parts.Length == 1)
            {
                //is seed line
                Victor = recordLine;
            }
        }

        public MatchRecord(string[] v, string winningGenome)
        {
            Competitors = v;
            Victor = winningGenome;
        }

        public override string ToString()
        {
            return Competitors[0] + Delimiter + Competitors[1] + Delimiter + Victor;
        }
    }
}
