using Assets.Src.Evolution;
using NUnit.Framework;
using System.Linq;
using UnityEngine;

namespace Assets.Editor.Evolution
{
    public class MatchConfigTests
    {
        private readonly MatchConfig _config = new MatchConfig
        {
            MinimumLocationRandomisation = 1,
            MaximumLocationRandomisation = 2
        };

        [Test]
        public void RandomLocationAlways_GivesRadiusBetweenMinAndMax()
        {
            for(var i = 0; i < 2000; i++)
            {
                var result = _config.RandomLocation();

                Assert.LessOrEqual(result.magnitude, _config.MaximumLocationRandomisation);
                Assert.GreaterOrEqual(result.magnitude, _config.MinimumLocationRandomisation);
            }
        }

        [Test]
        public void PositionForCompetitor_GiviesGoesAroundArc()
        {
            var config = new MatchConfig
            {
                InitialRange = 100,
                StepForwardProportion = 0.5f,
                MaximumLocationRandomisation = 0,
                MinimumLocationRandomisation = 0
            };

            var numberOfShips = 10;
            var positions = Enumerable.Range(0, numberOfShips * 2);

            var results = positions.Select(p => config.PositionForCompetitor(p, numberOfShips, 0));
   
            var expectedAngles = new float[]
             {
                0,
                36,
                72,
                108,
                144,
                180,
                216,
                252,
                288,
                324,
                0,
                36,
                72,
                108,
                144,
                180,
                216,
                252,
                288,
                324
             };
            var tollerance = 0.001f;

            var i = 0;
            foreach (var position in results)
            {
                Assert.LessOrEqual(config.InitialRange - tollerance, position.magnitude);
                Assert.GreaterOrEqual(config.InitialRange + tollerance, position.magnitude);

                var angle = Vector3.SignedAngle(Vector3.right, position, Vector3.up);
                Debug.Log(angle);
                Assert.LessOrEqual(expectedAngles[i] - tollerance, angle);
                Assert.GreaterOrEqual(expectedAngles[i] + tollerance, angle);

                i++;
            }
        }

        [Test]
        public void PositionForCompetitor_StepForwardGivesExpectedLocations()
        {
            var config = new MatchConfig
            {
                InitialRange = 100,
                StepForwardProportion = 0.5f,
                MaximumLocationRandomisation = 0,
                MinimumLocationRandomisation = 0
            };

            var steps = Enumerable.Range(-3, 3);

            var results = steps.Select(p => config.PositionForCompetitor(1, 1, p));

            var expectedXLocations = new float[]
             {
                config.InitialRange * 8,
                config.InitialRange * 4,
                config.InitialRange * 2,
                config.InitialRange,
                config.InitialRange / 2,
                config.InitialRange / 4,
                config.InitialRange / 8
             };

            var i = 0;
            foreach (var position in results)
            {
                Assert.AreEqual(expectedXLocations[i], position.magnitude);

                i++;
            }
        }
    }
}
