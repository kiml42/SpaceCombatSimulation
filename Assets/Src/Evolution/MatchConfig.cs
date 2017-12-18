using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class MatchConfig
    {
        public int Id;

        public float MatchTimeout = 10000;

        public float WinnerPollPeriod = 1;

        public float InitialRange = 6000;

        public Vector3 PositionForCompetitor(int index)
        {
            var distanceToCentre = InitialRange / 2;

            //alternate +ve and -ve signs, +1 so that the first is -ve
            var sign = Math.Pow(-1, index + 1);

            var value = (float)(sign * distanceToCentre);

            switch (index % 6)
            {
                case 2:
                    //+-y direction
                    return new Vector3(0, value, 0);
                case 3:
                    //+-y direction
                    return new Vector3(0, value, 0);
                case 4:
                    //+-z direction
                    return new Vector3(0, 0, value);
                case 5:
                    //+-z direction
                    return new Vector3(0, 0, value);
                default:
                    //+- x direction
                    return new Vector3(value, 0, 0);
            }
        }
    }
}
