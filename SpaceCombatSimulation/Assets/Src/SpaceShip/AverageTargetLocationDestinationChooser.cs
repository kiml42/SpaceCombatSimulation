using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Linq;
using UnityEngine;

namespace Assets.Src.SpaceShip
{
    public class AverageTargetLocationDestinationChooser : IDestinationChooser
    {
        private readonly ITargetDetector _detector;
        private readonly ITargetPicker _picker;
        private readonly Rigidbody _destination;

        public AverageTargetLocationDestinationChooser(ITargetDetector detector, ITargetPicker picker, Rigidbody destination)
        {
            _detector = detector;
            _destination = destination;
            _picker = picker;
        }

        public Rigidbody GetDestinationObject()
        {
            var targets = _detector
                .DetectTargets()
                .Select(t => t.Rigidbody.GetComponent<Rigidbody>())
                .Where(t => t != null)
                .Select(t => new PotentialTarget(t));

            //Debug.Log("unfiltered " + targets.Count());
            targets = _picker.FilterTargets(targets);

            var maxScore = targets.Max(t => t.Score);
                
            targets=targets.Where(t =>
                t.Score >= 0.5*maxScore
            );

            //Debug.Log("filtered " + targets.Count());
            
            //Vector3 locationSum = SumVecors(targets.Select(t => t.position));
            if (targets.Any())
            {
                var averageXLocation = targets.Average(t => t.Rigidbody.position.x);
                var averageYLocation = targets.Average(t => t.Rigidbody.position.y);
                var averageZLocation = targets.Average(t => t.Rigidbody.position.z);
                _destination.position = new Vector3(averageXLocation, averageYLocation, averageZLocation);

                var averageXVelocity = targets.Average(t => t.Rigidbody.velocity.x);
                var averageYVelocity = targets.Average(t => t.Rigidbody.velocity.y);
                var averageZVelocity = targets.Average(t => t.Rigidbody.velocity.z);
                _destination.velocity = new Vector3(averageXVelocity, averageYVelocity, averageZVelocity);
            }
            else
            {
                _destination.position = Vector3.zero;
                _destination.velocity = Vector3.zero;
            }
            return _destination;

        }

        //private Vector3 SumVecors(IEnumerable<Vector3> enumerable)
        //{
        //    var vector = 0;
        //    foreach (var item in collection)
        //    {

        //    }
        //}
    }
}
