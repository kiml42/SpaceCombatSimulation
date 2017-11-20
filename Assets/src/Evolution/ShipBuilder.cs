using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.Evolution
{
    public class ShipBuilder : IKnowsEnemyTags
    {

        #region EnemyTags
        public void AddEnemyTag(string newTag)
        {
            var tags = EnemyTags.ToList();
            tags.Add(newTag);
            EnemyTags = tags.Distinct().ToList();
        }

        public void SetEnemyTags(List<string> allEnemyTags)
        {
            EnemyTags = allEnemyTags;
        }

        public List<string> GetEnemyTags()
        {
            return EnemyTags;
        }

        public List<string> EnemyTags;
        #endregion

        public int MaxTurrets = 10;
        public int MaxModules = 15;
        private int _turretsAdded = 0;
        private int _modulesAdded = 0;

        public float MaxShootAngle = 180;
        public float DefaultShootAngleProportion = 0.5f;
        public float MaxLocationAimWeighting = 2;
        public float DefaultLocationAimWeightingProportion = 0.5f;
        public float MaxSlowdownWeighting = 70;
        public float DefaultSlowdownWeightingProportion = 0.5f;
        public float MaxTangentialVelosityWeighting = 70;
        public float DefaultTangentialVelosityWeightingProportion = 0.5f;
        public float MaxMaxAndMinRange = 1000;
        public float DefaultMaxAndMinRangeProportion = 0.1f;
        public float MaxVelociyTollerance = 100;
        public float DefaultVelociyTolleranceProportion = 0.1f;
        public float MaxAngularDragForTorquers = 1;
        public float DefaultAngularDragForTorquersProportion = 0.2f;

        public Vector3 InitialVelocity = Vector3.zero;


        private string _genome;
        public int GeneLength = 1;

        private ModuleList _moduleList;

        private int _genomePosition = 0;
        private Transform _shipToBuildOn;
        private TestCubeChecker _testCubePrefab;

        public Color ColourOverride;
        private Color _colour;

        public ShipBuilder(string genome, Transform shipToBuildOn, ModuleList moduleList, TestCubeChecker testCubePrefab = null)
        {
            _shipToBuildOn = shipToBuildOn;
            if (_shipToBuildOn == null)
            {
                throw new ArgumentNullException("shipToBuildOn", "shipToBuildOn must be a valid Transform.");
            }
            _moduleList = moduleList;
            if(_moduleList == null)
            {
                throw new ArgumentNullException("moduleList", "moduleList must be a valid ModuleList objet.");
            }
            _genome = genome;
            _testCubePrefab = testCubePrefab;
        }

        public void BuildShip(bool ConfigureConstants = true, bool setName = true, bool setColour = true)
        {
            //Debug.Log("Building " + _genome);
            if (setColour)
            {
                if(ColourOverride != null)
                {
                    _colour = ColourOverride;
                } else
                {
                    var r = GetNumberFromGenome(0, 0.5f, 8);
                    var g = GetNumberFromGenome(10, 0.5f, 8);
                    var b = GetNumberFromGenome(20, 0.5f, 8);

                    _colour = new Color(r, g, b);
                }
                _shipToBuildOn.SetColor(_colour);
            }

            if(setName)
                _shipToBuildOn.name = _genome;
            //Debug.Log("Spawning modules");

            _usedLocations.Add(_shipToBuildOn.position);
            SpawnModules(_shipToBuildOn);

            if(ConfigureConstants)
                ConfigureShip();
        }

        public void SetGenome(string genome)
        {
            _genome = genome;
        }

        private void SpawnModules(Transform currentHub)
        {
            var spawnPoints = GetSpawnPoints(currentHub);
            if (spawnPoints.Any())
            {
                //this is a hub - add more modules to it
                foreach (var spawnPoint in spawnPoints)
                {
                    if (CanSpawnHere(spawnPoint))
                    {
                        var moduleToAdd = SelectModule();

                        if (moduleToAdd != null)
                        {
                            //Debug.Log("adding " + moduleToAdd);
                            var addedModule = GameObject.Instantiate(moduleToAdd, spawnPoint.position, spawnPoint.rotation, currentHub);
                            
                            addedModule.GetComponent<FixedJoint>().connectedBody = currentHub.GetComponent<Rigidbody>();
                            addedModule.SendMessage("SetEnemyTags", EnemyTags, SendMessageOptions.DontRequireReceiver);

                            addedModule.tag = currentHub.tag;

                            SpawnModules(addedModule.transform);    //spawn modules on this module

                            addedModule.transform.SetColor(_colour);
                            addedModule.velocity = InitialVelocity;
                        }
                        //else
                        //{
                        //    Debug.Log("skipping null module");
                        //}
                    }
                    //else
                    //{
                    //    Debug.Log("Can not spawn module here. _genomePosition: " + _genomePosition + ", _turretsAdded: " + _turretsAdded + ", _modulesAdded: " + _modulesAdded);
                    //}
                }
            }
            else
            {
                //this has no spawn points, so it must be aturret or engine - increment added turrets.
                //Debug.Log("Cannot spawn on " + currentHub);
                _turretsAdded++;
            }
            _modulesAdded++;
        }

        private List<Vector3> _usedLocations = new List<Vector3>();

        /// <summary>
        /// The distance below which two test cubes colliders are considered too close to spawn.
        /// </summary>
        private const float THRESHOLD_DISTANCE = 1;

        private bool CanSpawnHere(Transform spawnPoint)
        {
            if (_testCubePrefab != null)
            {
                //Debug.Log("Creating Test Cube");
                var testCube = GameObject.Instantiate(_testCubePrefab, spawnPoint.position, spawnPoint.rotation);
                var collider = testCube.GetComponent<BoxCollider>();
                var center = collider.center;
                center = testCube.transform.TransformPoint(center); //turn it into world coords.
                //collider.bounds.Intersects();//could be useful if the center isn't enough.
                GameObject.Destroy(testCube.gameObject);
                if (IsUsedLocation(center))
                {
                    //Debug.Log("Can't spawn at " + center + " because there is already something here");
                    return false;
                }
                else
                {
                    _usedLocations.Add(center);
                }
            }
            var canSpawn = _genomePosition < _genome.Length && _turretsAdded < MaxTurrets && _modulesAdded < MaxModules;
            //Debug.Log("can Spawn: " + canSpawn);
            return canSpawn;
        }

        private bool IsUsedLocation(Vector3 worldLocation)
        {
            var distances = _usedLocations.Select(l => Vector3.Distance(l, worldLocation));
            return distances.Any(d => d < THRESHOLD_DISTANCE);
        }

        private List<Transform> GetSpawnPoints(Transform currentHub)
        {
            var _spawnPoints = new List<Transform>();
            var childCount = currentHub.childCount;
            for (int i = 0; i < childCount; i++)
            {
                var child = currentHub.GetChild(i);
                if (child.name.Contains("SP"))
                {
                    _spawnPoints.Add(child);
                }
            }
            return _spawnPoints;
        }

        private Rigidbody SelectModule()
        {
            if (_genomePosition + GeneLength <= _genome.Length)
            {
                var substring = _genome.Substring(_genomePosition, GeneLength);
                //Debug.Log("Gene to spawn: " + substring);
                _genomePosition += GeneLength;

                var simplified = substring.Replace(" ", "");

                int number;
                if (int.TryParse(simplified, out number))
                {
                    //Debug.Log("Gene as number: " + number);
                    if (number < _moduleList.Modules.Count())
                    {
                        //Debug.Log("Adding Module " + number + ": " + Modules[number] );
                        return _moduleList.Modules[number];
                    }
                    //else
                    //{
                    //    Debug.Log("there are " + Modules.Count() + " modules, so cannot spawn number " + number);
                    //}
                }
                //else
                //{
                //    Debug.Log("Failed to parse " + simplified + "as a number");
                //}
            }
            //else
            //{
            //    Debug.Log("Cannot read gene of length " + GeneLength + " at position " + _genomePosition + " in '" + _genome + "'");
            //}
            return null;
        }

        private void ConfigureShip()
        {
            var controller = _shipToBuildOn.GetComponent<SpaceShipControler>();

            //Debug.Log("ConfiguringShip");

            controller.ShootAngle =
                GetNumberFromGenome(0, DefaultShootAngleProportion) * MaxShootAngle;
            controller.LocationAimWeighting =
                GetNumberFromGenome(2, DefaultLocationAimWeightingProportion) * MaxLocationAimWeighting;
            controller.SlowdownWeighting =
                GetNumberFromGenome(4, DefaultSlowdownWeightingProportion) * MaxSlowdownWeighting;
            controller.MaxRange =
                GetNumberFromGenome(6, DefaultMaxAndMinRangeProportion) * MaxMaxAndMinRange;
            controller.MinRange =
                GetNumberFromGenome(8, DefaultMaxAndMinRangeProportion) * MaxMaxAndMinRange;
            controller.MaxTangentialVelocity =
                GetNumberFromGenome(10, DefaultVelociyTolleranceProportion) * MaxVelociyTollerance;
            controller.MinTangentialVelocity =
                GetNumberFromGenome(12, DefaultVelociyTolleranceProportion) * MaxVelociyTollerance;
            controller.TangentialSpeedWeighting =
                GetNumberFromGenome(14, DefaultTangentialVelosityWeightingProportion) * MaxTangentialVelosityWeighting;
            controller.AngularDragForTorquers =
                GetNumberFromGenome(16, DefaultAngularDragForTorquersProportion) * MaxAngularDragForTorquers;
            controller.RadialSpeedThreshold =
                GetNumberFromGenome(18, DefaultVelociyTolleranceProportion) * MaxVelociyTollerance;
        }

        private float GetNumberFromGenome(int fromEnd, float defaultProporion = 0.5f, int length = 2)
        {
            var reversed = Reverse(_genome);
            if (fromEnd + length < reversed.Length)
            {
                var substring = reversed.Substring(fromEnd, length);
                
                var simplified = substring.TrimStart().Replace(" ", "0");
                //Debug.Log(simplified);
                int number;
                if (int.TryParse(simplified, out number))
                {
                    return (float)(number / (Math.Pow(10, length) - 1));
                }
            }
            //Debug.Log("Defaulted to 0.5");
            return defaultProporion;
        }

        public static string Reverse(string s)
        {
            char[] charArray = s.ToCharArray();
            Array.Reverse(charArray);
            return new string(charArray);
        }
    }
}

