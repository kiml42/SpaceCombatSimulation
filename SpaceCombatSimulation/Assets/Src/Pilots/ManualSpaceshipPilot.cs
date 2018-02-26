using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Pilots
{
    public class ManualSpaceshipPilot : BasePilot
    {
        public ManualSpaceshipPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, List<EngineControler> engines, float fuel = Mathf.Infinity)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;

            foreach (var engine in engines.ToList())
            {
                AddEngine(engine);
            }
        }

        public override void Fly(Target target)
        {
            RemoveNullEngines();
            if (HasActivated())
            {
                var worldTurningVector = ReadWorldTurnVectorFromControls();

                //Debug.Log(
                //    "slowdownMode: " + _slowdownMode +
                //    ", distance: " + Math.Round(distance, 1) +
                //    ", approachVector: " + approachVector +
                //    ", tanSpeed: " + Math.Round(tanSpeed, 3) +
                //    ", tanSpeedVector: " + tanSpeedVector +
                //    ", VApproach: " + Math.Round(targetsApproachVelocity.magnitude, 3) +
                //    ", slowdownVector: " + slowdownVector +
                //    ", turningVector: " + turningVector);

                _torqueApplier.TurnToVectorInWorldSpace(worldTurningVector);

                if (VectorArrow != null)
                {
                    if (worldTurningVector.magnitude > 0)
                    {
                        VectorArrow.rotation = Quaternion.LookRotation(worldTurningVector);
                        VectorArrow.localScale = Vector3.one;
                    } else
                    {
                        VectorArrow.localScale = Vector3.zero;
                    }
                }

                var forceVector = ReadWorldForceVectorFromControls();
                SetFlightVectorOnEngines(forceVector);  //turn off the engine
            }
            else
            {
                SetFlightVectorOnEngines(null);  //turn off the engine
            }
        }

        private Vector3 ReadWorldTurnVectorFromControls()
        {
            var down = Input.GetKey(KeyCode.W);
            var up = Input.GetKey(KeyCode.S);
            var left = Input.GetKey(KeyCode.A);
            var right = Input.GetKey(KeyCode.D);

            var turningVector = Vector3.forward;
            if (up)
            {
                turningVector += Vector3.up;
            }
            if (down)
            {
                turningVector += Vector3.down;
            }
            if (right)
            {
                turningVector += Vector3.right;
            }
            if (left)
            {
                turningVector += Vector3.left;
            }

            //Debug.Log("turningVector: " + turningVector);

            return _pilotObject.transform.TransformDirection(turningVector);
        }

        private Vector3 ReadWorldForceVectorFromControls()
        {
            var fwd = Input.GetKey(KeyCode.H);
            var back = Input.GetKey(KeyCode.N);
            var down = Input.GetKey(KeyCode.I);
            var up = Input.GetKey(KeyCode.K);
            var left = Input.GetKey(KeyCode.J);
            var right = Input.GetKey(KeyCode.L);

            var forceVector = Vector3.zero;
            if (fwd)
            {
                forceVector += Vector3.forward;
            }
            if (back)
            {
                forceVector += Vector3.back;
            }
            if (up)
            {
                forceVector += Vector3.up;
            }
            if (down)
            {
                forceVector += Vector3.down;
            }
            if (right)
            {
                forceVector += Vector3.right;
            }
            if (left)
            {
                forceVector += Vector3.left;
            }

            //Debug.Log("turningVector: " + turningVector);

            return _pilotObject.transform.TransformDirection(forceVector);
        }
    }
}
